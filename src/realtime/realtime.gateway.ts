import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '@/api/client/auth/strategies/jwt.strategy';
import { isProductionEnv } from '@/common/constants/app.constants';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import type { EnvConfig } from '@/config/env.validation';
import { ChannelManager } from './channels/channel-manager.service';
import { extractSocketToken } from './guards/socket-auth.helper';
import type { RealtimeEnvelope } from './realtime.dto';
import type { RealtimeTransport } from './transports/realtime-transport.interface';

/** 配置的访问源（模块加载时读取一次，避免每次握手重复读 env；归一化尾斜杠防止与 origin 严格比较失配） */
const APP_URL_ORIGIN = (process.env.APP_URL ?? 'http://localhost:4300').replace(/\/+$/, '');

/**
 * 统一实时 WebSocket 网关 (Socket.IO)
 * 挂载于 `/realtime` 命名空间，实现标准 RFC/Socket.IO 全双工连接与房间组播。
 */
@Injectable()
@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    // W3C 规范：credentials: true 不允许与 origin: '*' 同时使用
    // 通过工厂函数动态校验允许的 origin，保持浏览器兼容性与安全性
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // 允许服务端直连（无 Origin 头）与配置的 APP_URL；localhost 通配仅限非生产环境（防本机恶意页面跨站握手）
      const allowed =
        !origin || origin === APP_URL_ORIGIN || (!isProductionEnv() && origin.startsWith('http://localhost'));
      callback(null, allowed);
    },
    credentials: true,
  },
})
export class RealtimeGateway
  implements RealtimeTransport, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  readonly name = 'websocket';

  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly channelManager: ChannelManager,
  ) {}

  afterInit(_server: Server): void {
    this.logger.log('[RealtimeGateway] Socket.IO gateway initialized on namespace /realtime');
  }

  onModuleDestroy(): void {
    // 优雅释放所有活跃长连接
    this.server?.disconnectSockets(true);
  }

  /** 获取当前活跃客户端连接数 */
  getActiveSocketsCount(): number {
    return this.server?.sockets?.sockets?.size ?? 0;
  }

  /**
   * 客户端握手鉴权（Fail-Fast）
   */
  async handleConnection(client: Socket): Promise<void> {
    const token = extractSocketToken(client);

    if (!token) {
      this.logger.warn(`[RealtimeGateway] Unauthorized connection attempt rejected: ${client.id}`);
      client.emit('error', { message: 'Authentication token is required to connect to /realtime' });
      setTimeout(() => client.disconnect(true), 50);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get('JWT_ACCESS_SECRET'),
      });

      // 绑定身份并自动加入该用户专属房间（支持同账号多设备广播）
      client.data.user = {
        id: Number(payload.sub),
        email: payload.email,
        role: payload.role,
      };
      client.join(`user:${payload.sub}`);

      this.logger.log(`[RealtimeGateway] Client connected: ${client.id} (userId=${payload.sub})`);

      client.emit('connected', {
        status: 'connected',
        socketId: client.id,
        userId: Number(payload.sub),
        timestamp: Date.now(),
      });
    } catch {
      this.logger.warn(`[RealtimeGateway] Invalid token handshake rejected: ${client.id}`);
      client.emit('error', { message: 'Invalid or expired authentication token' });
      setTimeout(() => client.disconnect(true), 50);
    }
  }

  handleDisconnect(client: Socket): void {
    if (client.data?.user) {
      this.logger.log(`[RealtimeGateway] Client disconnected: ${client.id} (active=${this.getActiveSocketsCount()})`);
    }
  }

  /**
   * 订阅指定业务频道/房间（动态执行 ChannelManager 权限校验）
   */
  @SubscribeMessage('subscribe')
  async handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() data: { channel?: string }) {
    if (!data?.channel || typeof data.channel !== 'string') {
      return { status: 'error', message: 'Missing or invalid channel parameter' };
    }

    const user = client.data?.user as CurrentUserPayload | undefined;
    if (!user) {
      return { status: 'unauthorized', message: 'Authentication required to subscribe to channels' };
    }

    const authResult = await this.channelManager.canSubscribe(user, data.channel);
    if (!authResult.authorized) {
      this.logger.warn(
        `[RealtimeGateway] Unauthorized subscription attempt by user ${user.id} to ${data.channel}: ${authResult.reason}`,
      );
      return {
        status: 'forbidden',
        channel: data.channel,
        message: authResult.reason ?? 'Forbidden',
      };
    }

    client.join(data.channel);
    this.logger.debug(`[RealtimeGateway] Socket ${client.id} joined channel: ${data.channel}`);

    return {
      status: 'ok',
      channel: data.channel,
      timestamp: Date.now(),
    };
  }

  /**
   * 退订指定业务频道/房间
   */
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(@ConnectedSocket() client: Socket, @MessageBody() data: { channel?: string }) {
    if (!data?.channel || typeof data.channel !== 'string') {
      return { status: 'error', message: 'Missing or invalid channel parameter' };
    }

    client.leave(data.channel);
    this.logger.debug(`[RealtimeGateway] Socket ${client.id} left channel: ${data.channel}`);

    return {
      status: 'ok',
      channel: data.channel,
      timestamp: Date.now(),
    };
  }

  /**
   * 满足 RealtimeTransport 契约：向指定用户专属房间投递
   */
  sendToUser<T = unknown>(envelope: RealtimeEnvelope<T>): void {
    if (envelope.targetUserId) {
      this.server?.to(`user:${envelope.targetUserId}`).emit(envelope.event, envelope.data);
    }
  }

  /**
   * 满足 RealtimeTransport 契约：向指定频道或全网广播
   */
  broadcast<T = unknown>(envelope: RealtimeEnvelope<T>): void {
    if (envelope.channel) {
      this.server?.to(envelope.channel).emit(envelope.event, envelope.data);
    } else {
      this.server?.emit(envelope.event, envelope.data);
    }
  }
}
