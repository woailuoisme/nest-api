import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  type MessageEvent,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { concat, fromEvent, interval, map, merge, type Observable, of, takeUntil } from 'rxjs';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import type { EnvConfig } from '@/config/env.validation';
import { ChannelManager } from './channels/channel-manager.service';
import type { PusherAuthDto, RealtimeEnvelope } from './realtime.dto';
import { RealtimeGateway } from './realtime.gateway';
import { PusherTransport } from './transports/pusher.transport';
import { REALTIME_PRIMARY_TRANSPORT, type RealtimeTransport } from './transports/realtime-transport.interface';
import { SseTransport } from './transports/sse.transport';

/**
 * 统一实时通信中枢服务 (Realtime Deep Facade)
 *
 * 架构收益：
 * 1. 深度模块（Deep Module）：极简接口（sendToUser / broadcast / subscribe / authenticatePusher / createSseStream），隐藏底层驱动适配细节；
 * 2. 多态接缝（Polymorphic Transport Seam）：通过 REALTIME_PRIMARY_TRANSPORT 调度底层单一根传输器，业务层 0 条件分支；
 * 3. 多驱动支持：支持 Local (内嵌 Socket.IO / SSE + Redis 集群) 与 Pusher (Soketi / Pusher 外部无状态网关) 双驱动平滑切换；
 * 4. 传输层安全管控：集成 ChannelManager 确保 SSE 与 WebSocket 统一权限屏障。
 */
@Injectable()
export class RealtimeService {
  constructor(
    @Inject(REALTIME_PRIMARY_TRANSPORT) private readonly primaryTransport: RealtimeTransport,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly sseTransport: SseTransport,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly channelManager: ChannelManager,
    @Optional() private readonly pusherTransport?: PusherTransport,
  ) {}

  /**
   * 获取当前生效的广播驱动
   */
  getDriver(): 'local' | 'pusher' {
    return this.configService.get('BROADCAST_DRIVER');
  }

  /**
   * 获取 Pusher 适配器（供认证端点生成签名使用）
   */
  getPusherTransport(): PusherTransport | undefined {
    return this.pusherTransport;
  }

  /**
   * 统一执行 Pusher / Soketi 频道订阅签名鉴权（消灭控制器重复代码）
   */
  async authenticatePusher(user: CurrentUserPayload, dto: PusherAuthDto) {
    const authResult = await this.channelManager.canSubscribe(user, dto.channel_name);
    if (!authResult.authorized) {
      throw new ForbiddenException(authResult.reason ?? 'Forbidden to subscribe to channel');
    }

    if (!this.pusherTransport?.getClient()) {
      throw new BadRequestException('Pusher driver is not configured (check REALTIME_URL in environment)');
    }

    const isPresence = dto.channel_name.startsWith('presence-') || dto.channel_name.startsWith('presence:');
    const presenceData = isPresence
      ? { user_id: String(user.id), user_info: { email: user.email, role: user.role } }
      : undefined;

    return this.pusherTransport.authorizeChannel(dto.socket_id, dto.channel_name, presenceData);
  }

  /**
   * 构造标准 SSE 事件流（集成初始握手包、专属订阅流、心跳保活与客户端断开清理）
   */
  createSseStream(user: CurrentUserPayload, req: FastifyRequest): Observable<MessageEvent> {
    const disconnect$ = fromEvent(req.raw, 'close');

    const initial$: Observable<MessageEvent> = of({
      type: 'connected',
      data: {
        status: 'connected',
        userId: user.id,
        timestamp: Date.now(),
      },
    });

    const events$ = this.subscribe(user);

    const heartbeat$: Observable<MessageEvent> = interval(25_000).pipe(
      map(
        (): MessageEvent => ({
          type: 'ping',
          data: { timestamp: Date.now() },
        }),
      ),
    );

    return concat(initial$, merge(events$, heartbeat$)).pipe(takeUntil(disconnect$));
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

    // 多态传输委托（本地复合驱动或 Pusher 驱动由 primaryTransport 隐藏接管）
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

    // 多态传输委托（本地复合驱动或 Pusher 驱动由 primaryTransport 隐藏接管）
    Promise.resolve(this.primaryTransport.broadcast(envelope)).catch(() => {});

    return envelope;
  }

  /**
   * 暴露给 SSE Controller 的订阅流工厂（支持完整用户上下文过滤）
   */
  subscribe(user: CurrentUserPayload | string): Observable<MessageEvent> {
    return this.sseTransport.subscribe(user);
  }

  /**
   * 获取当前网关活跃 WebSocket 连接数
   */
  getActiveSocketsCount(): number {
    return this.realtimeGateway.getActiveSocketsCount();
  }
}
