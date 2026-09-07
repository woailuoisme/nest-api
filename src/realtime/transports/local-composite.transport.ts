import { Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import type { RealtimeEnvelope } from '../realtime.dto';
import { RealtimeGateway } from '../realtime.gateway';
import type { RealtimeTransport } from './realtime-transport.interface';
import { RedisPubSubAdapter } from './redis-pubsub.adapter';
import { SseTransport } from './sse.transport';

/**
 * 本地多通道复合传输器 (LocalCompositeTransport)
 *
 * 核心设计：
 * 1. 组合进程内 Server-Sent Events (SseTransport) 与全双工 WebSocket 网关 (RealtimeGateway)；
 * 2. 在集群模式下透明挂载 RedisPubSubAdapter 实现跨 Pod 广播与单机防回环去重；
 * 3. 作为 RealtimeTransport 契约的具体实现，将多通道与集群分发细节完整封装在接缝内部。
 */
@Injectable()
export class LocalCompositeTransport implements RealtimeTransport, OnModuleInit {
  readonly name = 'local-composite';

  constructor(
    private readonly sseTransport: SseTransport,
    private readonly realtimeGateway: RealtimeGateway,
    @Optional() private readonly redisAdapter?: RedisPubSubAdapter,
  ) {}

  onModuleInit(): void {
    // 若启用了 Redis 集群广播，监听来自其他 Pod 节点的事件并分发至本地长连接 (避免重复回环发布)
    if (this.redisAdapter) {
      this.redisAdapter.setForwarder((envelope) => {
        this.dispatchDirectLocally(envelope);
      });
    }
  }

  async sendToUser<T = unknown>(envelope: RealtimeEnvelope<T>): Promise<void> {
    // 1. 本地分发至当前 Pod 活跃的 SSE 与 WebSocket 连接
    this.dispatchDirectLocally(envelope);

    // 2. 广播至集群总线（通知集群其他 Pod 节点下发）
    await this.redisAdapter?.publish(envelope);
  }

  async broadcast<T = unknown>(envelope: RealtimeEnvelope<T>): Promise<void> {
    // 1. 本地广播至当前 Pod 活跃的 SSE 与 WebSocket 频道
    this.dispatchDirectLocally(envelope);

    // 2. 广播至集群总线
    await this.redisAdapter?.publish(envelope);
  }

  /**
   * 仅在本地实例执行双通道投递（不触发 Redis 集群回环）
   */
  private dispatchDirectLocally(envelope: RealtimeEnvelope): void {
    if (envelope.targetUserId) {
      this.sseTransport.sendToUser(envelope);
      this.realtimeGateway.sendToUser(envelope);
    } else {
      this.sseTransport.broadcast(envelope);
      this.realtimeGateway.broadcast(envelope);
    }
  }
}
