import { Injectable, Logger } from '@nestjs/common';

import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

import type { ChannelAuthorizer, ChannelAuthResult, CompiledChannelRule } from './channel.types';

/**
 * 频道动态授权管理器 (Channel Authorization Manager)
 *
 * 核心机制（对齐 Laravel routes/channels.php）：
 * 1. 私有频道准入管控：拦截 WebSocket 客户端的 `subscribe` 请求并进行动态鉴权；
 * 2. 模式匹配与参数抽取：支持 `private:user.{userId}` 与 `private:admin.*` 等路由化规则；
 * 3. 默认安全原则：`private:` 开头的频道若无显式放行规则，一律默认拒绝 (Fail-Safe)。
 */
@Injectable()
export class ChannelManager {
  private readonly logger = new Logger(ChannelManager.name);
  private readonly rules: CompiledChannelRule[] = [];

  constructor() {
    this.registerDefaultRules();
  }

  /**
   * 注册频道授权规则
   * @param pattern 频道匹配模式 (如 'private:user.{userId}', 'private:admin.*')
   * @param authorizer 授权逻辑函数
   */
  register(pattern: string, authorizer: ChannelAuthorizer): this {
    const paramNames: string[] = [];

    // 1. 转义点号，避免与正则通配符冲突
    let regexStr = pattern.replace(/\./g, '\\.');

    // 2. 提取并替换命名参数 {paramName} -> 命名捕获组
    regexStr = regexStr.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, paramName) => {
      paramNames.push(paramName);
      return '([^.:/]+)';
    });

    // 3. 替换末尾通配符 * -> .*
    regexStr = regexStr.replace(/\*/g, '.*');

    const regex = new RegExp(`^${regexStr}$`);

    this.rules.push({
      pattern,
      regex,
      paramNames,
      authorizer,
    });

    return this;
  }

  /**
   * 规范化频道名称前缀（透明桥接 private: 与 private-，presence: 与 presence-）
   */
  static normalizeChannel(channelName: string): string {
    return channelName.replace(/^(private|presence)[-:]/, '$1:');
  }

  /**
   * 校验当前用户是否有权订阅目标频道
   */
  async canSubscribe(user: CurrentUserPayload, channelName: string): Promise<ChannelAuthResult> {
    const normalized = ChannelManager.normalizeChannel(channelName);

    for (const rule of this.rules) {
      const match = normalized.match(rule.regex);
      if (match) {
        const params: Record<string, string> = {};
        rule.paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });

        try {
          const isAllowed = await rule.authorizer(user, params);
          if (isAllowed) {
            return { authorized: true };
          }
          return {
            authorized: false,
            reason: `User ${user.id} is forbidden to join channel [${channelName}]`,
          };
        } catch (err) {
          this.logger.error(`Channel authorization evaluation failed for [${channelName}]: ${(err as Error).message}`);
          return {
            authorized: false,
            reason: 'Internal authorization error',
          };
        }
      }
    }

    // 默认安全准则：private 与 presence 频道无规则直接拒绝；非受限频道默认作为公共房间放行
    if (normalized.startsWith('private:') || normalized.startsWith('presence:')) {
      return {
        authorized: false,
        reason: `No authorization rule defined for restricted channel [${channelName}]`,
      };
    }

    return { authorized: true };
  }

  /**
   * 注册脚手架开箱即用的核心内置规则
   */
  private registerDefaultRules(): void {
    // 1. 用户私有频道：仅允许当前同名用户接入
    this.register('private:user.{userId}', (user, params) => {
      return user.id === params.userId;
    });

    // 2. 管理员专属私有频道：仅具备管理角色的用户可订阅
    this.register('private:admin.*', (user) => {
      return [Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR].includes(user.role);
    });
  }
}
