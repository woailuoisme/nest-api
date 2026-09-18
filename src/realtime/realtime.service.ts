import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ChannelManager } from './channels/channel-manager.service';
import type {
  RealtimeEnvelope,
  RealtimeSubscribeDto,
  RealtimeSubscribeResponse,
  RealtimeTokenResponse,
} from './dto/realtime.dto';
import type { CentrifugoHealthStatus } from './transports/centrifugo.transport';
import { CentrifugoTransport } from './transports/centrifugo.transport';
import { REALTIME_PRIMARY_TRANSPORT, type RealtimeTransport } from './transports/realtime-transport.interface';

/**
 * 统一实时通信中枢服务 (Realtime Deep Facade)
 *
 * 架构收益：
 * 1. 深度模块（Deep Module）：极简领域接口（sendToUser / broadcast / batchBroadcast / createConnectionToken / authorizeSubscription）；
 * 2. 纯无状态发布中心：全量委托 Centrifugo 独立长连接网关，Node.js 进程零长连接与网络 IO 负担；
 * 3. 传输层安全管控：集成 ChannelManager 确保私有频道与在场频道严格执行统一准入鉴权。
 */
@Injectable()
export class RealtimeService {
  constructor(
    @Inject(REALTIME_PRIMARY_TRANSPORT) private readonly primaryTransport: RealtimeTransport,
    private readonly channelManager: ChannelManager,
    private readonly centrifugoTransport: CentrifugoTransport,
  ) {}

  /**
   * 获取当前生效的广播驱动
   */
  getDriver(): 'centrifugo' {
    return 'centrifugo';
  }

  /**
   * 获取 Centrifugo 适配器
   */
  getCentrifugoTransport(): CentrifugoTransport {
    return this.centrifugoTransport;
  }

  /**
   * 获取客户端 WebSocket 连接终端地址
   */
  getWsUrl(): string {
    if (!this.centrifugoTransport) {
      return 'ws://127.0.0.1:8000/connection/websocket';
    }
    return this.centrifugoTransport.getWsUrl();
  }

  /**
   * 获取客户端 SSE 连接终端地址
   */
  getSseUrl(): string {
    if (!this.centrifugoTransport) {
      return 'http://127.0.0.1:8000/connection/sse';
    }
    return this.centrifugoTransport.getSseUrl();
  }

  /**
   * 签发长连接 Connection Token (JWT)
   */
  createConnectionToken(user: CurrentUserPayload, ttlSeconds?: number): RealtimeTokenResponse {
    if (!this.centrifugoTransport) {
      throw new BadRequestException('Centrifugo transport is not available');
    }
    return this.centrifugoTransport.generateConnectionToken(user, ttlSeconds);
  }

  /**
   * 频道订阅鉴权并签发 Subscription Token (JWT)
   */
  async authorizeSubscription(
    user: CurrentUserPayload,
    dto: RealtimeSubscribeDto,
    ttlSeconds?: number,
  ): Promise<RealtimeSubscribeResponse> {
    const authResult = await this.channelManager.canSubscribe(user, dto.channel);
    if (!authResult.authorized) {
      throw new ForbiddenException(authResult.reason ?? 'Forbidden to subscribe to channel');
    }

    if (!this.centrifugoTransport) {
      throw new BadRequestException('Centrifugo driver is not configured (check REALTIME_URL in environment)');
    }

    return this.centrifugoTransport.generateSubscriptionToken(user, dto.channel, dto.client, ttlSeconds);
  }

  /**
   * 校验用户是否有权订阅目标频道 (委托给 ChannelManager 模式匹配)
   */
  async canSubscribe(user: CurrentUserPayload, channel: string) {
    return this.channelManager.canSubscribe(user, channel);
  }

  /**
   * 向指定用户精准定向推送实时事件
   * @param userId 目标用户 ID
   * @param event 事件名
   * @param data 业务载荷
   */
  sendToUser<T = unknown>(userId: string, event: string, data: T): RealtimeEnvelope<T> {
    const envelope: RealtimeEnvelope<T> = {
      event,
      targetUserId: userId,
      data,
      timestamp: Date.now(),
    };

    // 异步安全派发至 Centrifugo 外部网关
    Promise.resolve(this.primaryTransport.sendToUser(envelope)).catch(() => {});

    return envelope;
  }

  /**
   * 向指定命名频道或全网广播实时事件
   * @param channel 频道名 (如 'system', 'orders.live', 'alerts')
   * @param event 事件名
   * @param data 业务载荷
   */
  broadcast<T = unknown>(channel: string, event: string, data: T): RealtimeEnvelope<T> {
    const envelope: RealtimeEnvelope<T> = {
      event,
      channel,
      data,
      timestamp: Date.now(),
    };

    // 异步安全派发至 Centrifugo 外部网关
    Promise.resolve(this.primaryTransport.broadcast(envelope)).catch(() => {});

    return envelope;
  }

  /**
   * 批量向多个频道广播实时事件 (通过 Centrifugo Batch HTTP API 并发管道)
   * @param publications 批量派发项列表
   */
  async batchBroadcast(publications: { channel: string; event: string; data: unknown }[]): Promise<void> {
    if (!publications || publications.length === 0) {
      return;
    }

    const items = publications.map((pub) => {
      const envelope: RealtimeEnvelope<unknown> = {
        channel: pub.channel,
        event: pub.event,
        data: pub.data,
        timestamp: Date.now(),
      };
      return {
        channel: pub.channel,
        envelope,
      };
    });

    if (this.centrifugoTransport) {
      await this.centrifugoTransport.batchPublish(
        items.map((item) => ({ channel: item.channel, data: item.envelope })),
      );
    } else {
      await Promise.all(items.map((item) => this.primaryTransport.broadcast(item.envelope)));
    }
  }

  /**
   * 探测 Centrifugo 服务的实时连通性与运行时指标
   */
  async checkHealth(): Promise<CentrifugoHealthStatus> {
    if (!this.centrifugoTransport) {
      return {
        status: 'down',
        nodesCount: 0,
        totalClients: 0,
        totalChannels: 0,
        error: 'Centrifugo transport is not available',
      };
    }
    return this.centrifugoTransport.checkHealth();
  }

  /**
   * 获取当前进程活跃长连接数
   * 在 Centrifugo 外部网关模式下，长连接由独立集群管理，本进程常态为 0
   */
  getActiveSocketsCount(): number {
    return 0;
  }
}
