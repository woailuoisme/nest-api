import { SetMetadata } from '@nestjs/common';

export const CHANNEL_AUTH_METADATA = 'REALTIME:CHANNEL_AUTH_METADATA';

export interface ChannelAuthMetadata {
  pattern: string;
}

/**
 * 声明式实时频道授权装饰器
 *
 * 标注于任意业务 Service 方法上，声明对特定频道模式（Private / Presence Channel）的订阅授权校验。
 * 系统在引导启动时（OnApplicationBootstrap）由 ChannelExplorerService 自动自省发现并注册至 ChannelManager。
 *
 * 方法签名契约：
 * `(user: CurrentUserPayload, params: Record<string, string>) => boolean | Promise<boolean>`
 *
 * @param pattern 频道匹配模式，支持命名参数提取，例如 'private:user.{userId}'、'private:orders.{orderId}'
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class OrderService {
 *   @ChannelAuth('private:orders.{orderId}')
 *   async authorizeOrder(user: CurrentUserPayload, { orderId }: { orderId: string }): Promise<boolean> {
 *     return this.checkUserAccess(user.id, orderId);
 *   }
 * }
 * ```
 */
export const ChannelAuth = (pattern: string): MethodDecorator => {
  return SetMetadata(CHANNEL_AUTH_METADATA, { pattern } satisfies ChannelAuthMetadata);
};
