import { Injectable, Optional } from '@nestjs/common';
import { CentrifugoTransport } from '../transports/centrifugo.transport';
import { DEFAULT_PRESENCE_TTL_SECONDS, type PresenceMember, type PresenceMemberInfo } from './presence.types';

interface InMemoryLeaseItem {
  member: PresenceMember<unknown>;
  expiresAt: number;
}

/**
 * 统一 Presence 在场状态感知服务
 *
 * 核心架构特性：
 * 1. Centrifugo 原生在场驱动：在生产环境中，全面委托 Centrifugo 独立长连接网关维护在场拓扑与心跳，
 *    通过 CentrifugoTransport.getPresence HTTP API 直接获取集群真实在线成员；
 * 2. 本地内存透明降级：在测试或未配置外部网关时，自动降级为轻量本地内存存储，保证单测与本地开发可用性；
 * 3. 彻底解耦 Redis：消除 Redis Hash/TTL Lease 轮子与巡检开销，实现真正的高内聚与零网络冗余。
 */
@Injectable()
export class PresenceService {
  /** 内存降级存储：channel -> userId -> { member, expiresAt } */
  private readonly memoryStore = new Map<string, Map<string, InMemoryLeaseItem>>();

  constructor(@Optional() private readonly centrifugoTransport?: CentrifugoTransport) {}

  /**
   * 成员加入 Presence 频道 (内存降级/本地测试模式)
   * 在 Centrifugo 生产网关模式下，客户端订阅 presence 频道即由网关自动维护在场状态。
   */
  async join<T = PresenceMemberInfo>(
    channel: string,
    member: PresenceMember<T>,
    ttlSeconds: number = DEFAULT_PRESENCE_TTL_SECONDS,
  ): Promise<{ isNew: boolean; member: PresenceMember<T> }> {
    let channelMap = this.memoryStore.get(channel);
    if (!channelMap) {
      channelMap = new Map();
      this.memoryStore.set(channel, channelMap);
    }

    const now = Date.now();
    const existing = channelMap.get(member.userId);
    const isNew = !existing || existing.expiresAt <= now;

    channelMap.set(member.userId, {
      member,
      expiresAt: now + ttlSeconds * 1000,
    });

    return { isNew, member };
  }

  /**
   * 成员离开 Presence 频道 (内存降级/本地测试模式)
   * 在 Centrifugo 生产网关模式下，客户端断开或取消订阅自动由网关触发 leave 事件。
   */
  async leave(channel: string, userId: string): Promise<boolean> {
    const channelMap = this.memoryStore.get(channel);
    if (!channelMap) {
      return false;
    }

    const existed = channelMap.delete(userId);
    if (channelMap.size === 0) {
      this.memoryStore.delete(channel);
    }
    return existed;
  }

  /**
   * 刷新在场租期心跳 (内存降级/本地测试模式)
   */
  async heartbeat(
    channel: string,
    userId: string,
    ttlSeconds: number = DEFAULT_PRESENCE_TTL_SECONDS,
  ): Promise<boolean> {
    const channelMap = this.memoryStore.get(channel);
    const item = channelMap?.get(userId);
    if (!item || item.expiresAt <= Date.now()) {
      return false;
    }

    item.member.updatedAt = Date.now();
    item.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }

  /**
   * 获取指定频道的所有在场有效成员
   * 优先委托 CentrifugoTransport HTTP API 查询集群实时在线成员，未连接或测试时透明降级为本地内存存储。
   */
  async getMembers<T = PresenceMemberInfo>(channel: string): Promise<PresenceMember<T>[]> {
    if (this.centrifugoTransport) {
      const remoteMembers = await this.centrifugoTransport.getPresence<T>(channel);
      if (remoteMembers.length > 0 || !this.memoryStore.has(channel)) {
        return remoteMembers.map((m) => ({
          userId: m.userId,
          clientId: m.clientId,
          userInfo: m.info as T,
          joinedAt: Date.now(),
          updatedAt: Date.now(),
        }));
      }
    }

    // 内存模式降级：先剔除过期租期，再返回剩余有效成员
    this.pruneExpired(channel);
    const channelMap = this.memoryStore.get(channel);
    if (!channelMap) {
      return [];
    }

    return Array.from(channelMap.values(), (item) => item.member as PresenceMember<T>);
  }

  /**
   * 获取指定频道中的单个在场成员
   */
  async getMember<T = PresenceMemberInfo>(channel: string, userId: string): Promise<PresenceMember<T> | null> {
    const members = await this.getMembers<T>(channel);
    return members.find((m) => m.userId === userId) ?? null;
  }

  /**
   * 清理过期租期成员，并返回被剔除的用户 ID 列表（内存降级模式维护）
   */
  async cleanExpired(channel: string): Promise<string[]> {
    return this.pruneExpired(channel);
  }

  /**
   * 内部方法：删除频道内已过期租期成员并返回其用户 ID；频道清空时顺手回收 Map 条目
   */
  private pruneExpired(channel: string): string[] {
    const channelMap = this.memoryStore.get(channel);
    if (!channelMap) {
      return [];
    }

    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [userId, item] of channelMap.entries()) {
      if (item.expiresAt <= now) {
        expiredIds.push(userId);
      }
    }

    for (const userId of expiredIds) {
      channelMap.delete(userId);
    }
    if (channelMap.size === 0) {
      this.memoryStore.delete(channel);
    }

    return expiredIds;
  }
}
