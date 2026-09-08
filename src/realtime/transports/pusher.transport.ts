import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Pusher from 'pusher';
import type { EnvConfig } from '@/config/env.validation';
import type { RealtimeEnvelope } from '../realtime.dto';
import type { RealtimeTransport } from './realtime-transport.interface';

export interface PusherConfig {
  appId: string;
  key: string;
  secret: string;
  host?: string;
  port?: number;
  useTLS?: boolean;
  cluster?: string;
}

/**
 * 解析统一 Pusher / Soketi DSN 连接串
 * @example pusher://app-key:app-secret@127.0.0.1:6001/app-id?cluster=mt1&useTls=false
 */
export function parsePusherDsn(dsn: string): PusherConfig {
  const url = new URL(dsn);
  const key = decodeURIComponent(url.username);
  const secret = decodeURIComponent(url.password);
  const appId = url.pathname.replace(/^\//, '');

  const cluster = url.searchParams.get('cluster') ?? undefined;
  const useTls = url.searchParams.get('useTls') === 'true' || url.searchParams.get('tls') === 'true';
  const host = url.hostname || undefined;
  const port = url.port ? Number(url.port) : undefined;

  return {
    appId,
    key,
    secret,
    host,
    port,
    useTLS: useTls,
    cluster: cluster || 'mt1',
  };
}

/**
 * 将内部频道名称标准化为 Pusher 官方要求的合法前缀 (private- 与 presence-)
 */
export function toPusherChannel(channel: string): string {
  return channel.replace(/^(private|presence):/, '$1-');
}

/**
 * 工业级 Pusher / Soketi 外部独立长连接网关适配器
 *
 * 核心特性：
 * 1. 后端彻底无状态化：长连接由独立的 Soketi (uWebSockets.js C++ 极速引擎) 或 Pusher 守护进程承载；
 * 2. 生产零断线：NestJS 业务应用发布重启不影响前端长连接；
 * 3. 官方协议兼容：前端可直接无缝对接 pusher-js、laravel-echo 等成熟生态。
 */
@Injectable()
export class PusherTransport implements RealtimeTransport {
  readonly name = 'pusher';
  private client: Pusher | null = null;
  private readonly logger = new Logger(PusherTransport.name);

  constructor(private readonly configService: ConfigService<EnvConfig, true>) {
    this.initClient();
  }

  private initClient(): void {
    const dsn = this.configService.get('REALTIME_URL');
    if (!dsn) {
      return;
    }

    try {
      const config = parsePusherDsn(dsn);
      const options: Pusher.Options = {
        appId: config.appId,
        key: config.key,
        secret: config.secret,
        useTLS: config.useTLS,
        ...(config.host
          ? { host: config.host, port: config.port ? String(config.port) : undefined }
          : { cluster: config.cluster ?? 'mt1' }),
      };

      this.client = new Pusher(options);
      this.logger.log(
        `[PusherTransport] Initialized with host=${config.host ?? 'pusher.com'}:${config.port ?? 443} (appId=${config.appId})`,
      );
    } catch (err) {
      this.logger.warn(`[PusherTransport] Failed to initialize from REALTIME_URL: ${(err as Error).message}`);
    }
  }

  getClient(): Pusher | null {
    return this.client;
  }

  /**
   * 向指定用户私有频道推送事件
   */
  async sendToUser<T = unknown>(envelope: RealtimeEnvelope<T>): Promise<void> {
    if (!this.client || !envelope.targetUserId) {
      return;
    }
    const channel = `private-user.${envelope.targetUserId}`;
    try {
      await this.client.trigger(channel, envelope.event, envelope.data);
    } catch (err) {
      this.logger.warn(
        `[PusherTransport] Failed to trigger event [${envelope.event}] to user ${envelope.targetUserId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 向指定频道广播事件
   */
  async broadcast<T = unknown>(envelope: RealtimeEnvelope<T>): Promise<void> {
    if (!this.client) {
      return;
    }

    const channel = toPusherChannel(envelope.channel ?? 'public-default');

    try {
      await this.client.trigger(channel, envelope.event, envelope.data);
    } catch (err) {
      this.logger.warn(
        `[PusherTransport] Failed to broadcast event [${envelope.event}] to channel ${channel}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 针对私有/在场频道生成合法的 Pusher 鉴权签名
   */
  authorizeChannel(socketId: string, channelName: string, data?: Pusher.PresenceChannelData) {
    if (!this.client) {
      throw new Error('Pusher client is not initialized (check REALTIME_URL configuration)');
    }
    const channel = toPusherChannel(channelName);
    return this.client.authorizeChannel(socketId, channel, data);
  }
}
