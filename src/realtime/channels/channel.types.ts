import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

/**
 * 频道授权处理函数
 * @param user 当前已认证用户的身份载荷
 * @param params 从频道名称中提取的命名参数 (如 private:user.{userId} 提取出的 { userId: '42' })
 */
export type ChannelAuthorizer = (
  user: CurrentUserPayload,
  params: Record<string, string>,
) => boolean | Promise<boolean>;

/**
 * 编译后的频道授权规则
 */
export interface CompiledChannelRule {
  readonly pattern: string;
  readonly regex: RegExp;
  readonly paramNames: string[];
  readonly authorizer: ChannelAuthorizer;
}

/**
 * 频道订阅授权检查结果
 */
export interface ChannelAuthResult {
  readonly authorized: boolean;
  readonly reason?: string;
}
