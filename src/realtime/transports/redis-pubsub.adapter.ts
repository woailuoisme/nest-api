import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from '@/database/redis.service';
import type { RealtimeEnvelope } from '../realtime.dto';

const CLUSTER_CHANNEL = 'realtime:cluster:events';

interface ClusteredRealtimeEnvelope<T = unknown> extends RealtimeEnvelope<T> {
  originPodId: string;
}

/**
 * 分布式 Redis Pub/Sub 广播适配器 (Candidate 3)
 *
 * 核心机制：
 * 1. 跨 Pod 广播：将本地发布的实时事件投递至 Redis Pub/Sub 通道；
 * 2. 节点去重：每个 Pod 分配独立随机 UUID，收到来自自身 Pod 的回环消息自动忽略；
 * 3. 容错降级：测试环境或 Redis 未就绪时静默降级为单机内存模式，不阻断主流程。
 */
@Injectable()
export class RedisPubSubAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisPubSubAdapter.name);
  private readonly podId = randomUUID();
  private subClient: Redis | null = null;
  private messageForwarder: ((envelope: RealtimeEnvelope) => void) | null = null;

  constructor(private readonly redisService: RedisService) {}

  async onModuleInit(): Promise<void> {
    try {
      const client = this.redisService.getClient();
      // 仅在真实 Redis 客户端环境激活订阅者
      if (client && typeof client.duplicate === 'function') {
        this.subClient = client.duplicate();
        await this.subClient.subscribe(CLUSTER_CHANNEL);

        this.subClient.on('message', (_channel: string, message: string) => {
          this.handleClusterMessage(message);
        });

        this.logger.log(`[RedisPubSubAdapter] Subscribed to cluster channel: ${CLUSTER_CHANNEL} (podId=${this.podId})`);
      }
    } catch (err) {
      this.logger.warn(
        `[RedisPubSubAdapter] Redis clustering disabled (running in standalone mode): ${(err as Error).message}`,
      );
    }
  }

  onModuleDestroy(): void {
    if (this.subClient) {
      try {
        this.subClient.unsubscribe(CLUSTER_CHANNEL).catch(() => {});
        this.subClient.quit().catch(() => {});
      } catch {
        // ignore
      }
      this.subClient = null;
    }
  }

  /**
   * 注册集群消息接收转发器 (通常由 RealtimeService 挂载)
   */
  setForwarder(forwarder: (envelope: RealtimeEnvelope) => void): void {
    this.messageForwarder = forwarder;
  }

  /**
   * 向全集群发布实时事件
   */
  async publish<T = unknown>(envelope: RealtimeEnvelope<T>): Promise<void> {
    try {
      const client = this.redisService.getClient();
      if (client && typeof client.publish === 'function') {
        const payload: ClusteredRealtimeEnvelope<T> = {
          ...envelope,
          originPodId: this.podId,
        };
        await client.publish(CLUSTER_CHANNEL, JSON.stringify(payload));
      }
    } catch {
      // 忽略或降级
    }
  }

  /**
   * 处理从 Redis 频道接收到的集群事件
   */
  private handleClusterMessage(message: string): void {
    try {
      const payload = JSON.parse(message) as ClusteredRealtimeEnvelope;
      // 忽略来自当前 Pod 自身发布的消息，避免二次回环触发
      if (payload.originPodId === this.podId) {
        return;
      }

      if (this.messageForwarder) {
        this.messageForwarder(payload);
      }
    } catch (err) {
      this.logger.debug(`[RedisPubSubAdapter] Failed to parse cluster message: ${(err as Error).message}`);
    }
  }
}
