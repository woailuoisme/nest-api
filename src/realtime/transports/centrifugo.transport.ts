import * as crypto from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import type { EnvConfig } from '@/config/env.validation';

import { RealtimeChannel } from '../channels/channel.constants';
import type { RealtimeEnvelope } from '../dto/realtime.dto';
import type { RealtimeTransport } from './realtime-transport.interface';

export interface CentrifugoConfig {
  apiKey: string;
  tokenSecret: string;
  apiUrl: string;
  host: string;
  port: number;
  useTLS: boolean;
}

export interface CentrifugoPresenceMember<T = Record<string, unknown>> {
  clientId: string;
  userId: string;
  info: T;
}

export interface CentrifugoHealthStatus {
  status: 'up' | 'down' | 'degraded';
  nodesCount: number;
  totalClients: number;
  totalChannels: number;
  version?: string;
  error?: string;
}

/** Centrifugo /api/info 返回的单节点运行时指标 */
interface CentrifugoNodeInfo {
  name: string;
  num_channels: number;
  num_clients: number;
  num_users: number;
  uid: string;
  uptime: number;
  version: string;
}

/** 构造不可用/降级健康响应：统一 0 计数，避免多处重复字面量 */
function buildUnavailableHealth(status: 'down' | 'degraded', error: string): CentrifugoHealthStatus {
  return { status, nodesCount: 0, totalClients: 0, totalChannels: 0, error };
}

/**
 * 原生安全 Base64URL 编码（零外部依赖）
 */
function toBase64Url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

/**
 * 原生 HS256 JWT 签名生成器
 */
export function signHs256Jwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signatureInput = `${headerB64}.${payloadB64}`;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(signatureInput);
  const signatureB64 = toBase64Url(hmac.digest());

  return `${signatureInput}.${signatureB64}`;
}

/**
 * 解析统一 Centrifugo DSN 连接串
 * @example centrifugo://api-key:token-secret@127.0.0.1:8000/api?tls=false
 */
export function parseCentrifugoDsn(dsn: string): CentrifugoConfig {
  const url = new URL(dsn);
  const apiKey = decodeURIComponent(url.username);
  const tokenSecret = decodeURIComponent(url.password);

  const useTLS = url.searchParams.get('useTls') === 'true' || url.searchParams.get('tls') === 'true';
  const host = url.hostname || '127.0.0.1';
  const defaultPort = useTLS ? 443 : 80;
  const port = url.port ? Number(url.port) : defaultPort;

  const protocol = useTLS ? 'https' : 'http';
  const pathname = url.pathname && url.pathname !== '/' ? url.pathname.replace(/\/$/, '') : '/api';
  const portPart = url.port ? `:${url.port}` : '';
  const apiUrl = `${protocol}://${host}${portPart}${pathname}`;

  return {
    apiKey,
    tokenSecret,
    apiUrl,
    host,
    port,
    useTLS,
  };
}

/**
 * 工业级 Centrifugo 外部独立长连接网关适配器
 *
 * 核心特性：
 * 1. 彻底无状态化与防雪崩：客户端使用 HMAC-SHA256 JWT 令牌鉴权，Centrifugo 本地无状态验签，百万长连接零 RPC 回源；
 * 2. 纯原生零外部依赖：纯原生 node:crypto 签名 + 原生 fetch 调度 Centrifugo HTTP API，无臃肿三方 SDK；
 * 3. 统一 DSN 配置规范：通过单一 centrifugo:// 格式解析 API Key、HMAC Secret 与服务地址；
 * 4. 生产级高可靠性：业务发布重启不影响前端 WebSocket 长连接，跨节点广播高并发毫秒级下发。
 */
@Injectable()
export class CentrifugoTransport implements RealtimeTransport {
  readonly name = 'centrifugo';
  private config: CentrifugoConfig | null = null;
  private readonly logger = new Logger(CentrifugoTransport.name);

  constructor(private readonly configService: ConfigService<EnvConfig, true>) {
    this.initConfig();
  }

  private initConfig(): void {
    const dsn = this.configService.get('REALTIME_URL');
    if (!dsn) {
      return;
    }

    try {
      this.config = parseCentrifugoDsn(dsn);
      this.logger.debug(
        `[CentrifugoTransport] Initialized with apiUrl=${this.config.apiUrl} (host=${this.config.host}:${this.config.port})`,
      );
    } catch (err) {
      this.logger.warn(`[CentrifugoTransport] Failed to parse REALTIME_URL: ${(err as Error).message}`);
    }
  }

  getConfig(): CentrifugoConfig | null {
    return this.config;
  }

  /**
   * 从 REALTIME_URL 推导客户端连接所需的协议与主机端口段
   * 标准端口 (80/443) 省略端口号；未配置 REALTIME_URL 时返回 null 由调用方回退默认地址
   */
  private resolveEndpointParts(): {
    wsProtocol: 'ws' | 'wss';
    httpProtocol: 'http' | 'https';
    authority: string;
  } | null {
    if (!this.config) {
      return null;
    }

    const { useTLS, port, host } = this.config;
    const isStandardPort = (useTLS && port === 443) || (!useTLS && port === 80);
    const authority = `${host}${isStandardPort ? '' : `:${port}`}`;

    return useTLS
      ? { wsProtocol: 'wss', httpProtocol: 'https', authority }
      : { wsProtocol: 'ws', httpProtocol: 'http', authority };
  }

  /**
   * 获取客户端 WebSocket 连接终端地址
   * 优先读取 CENTRIFUGO_PUBLIC_WS_URL，未配置时从 REALTIME_URL 推导
   */
  getWsUrl(): string {
    const publicUrl = this.configService.get('CENTRIFUGO_PUBLIC_WS_URL', { infer: true });
    if (publicUrl) {
      return publicUrl;
    }

    const parts = this.resolveEndpointParts();
    return parts
      ? `${parts.wsProtocol}://${parts.authority}/connection/websocket`
      : 'ws://127.0.0.1:8000/connection/websocket';
  }

  /**
   * 获取客户端 SSE 连接终端地址
   * 优先读取 CENTRIFUGO_PUBLIC_SSE_URL，未配置时从 REALTIME_URL 推导
   */
  getSseUrl(): string {
    const publicUrl = this.configService.get('CENTRIFUGO_PUBLIC_SSE_URL', { infer: true });
    if (publicUrl) {
      return publicUrl;
    }

    const parts = this.resolveEndpointParts();
    return parts ? `${parts.httpProtocol}://${parts.authority}/connection/sse` : 'http://127.0.0.1:8000/connection/sse';
  }

  /**
   * 获取已配置的 HMAC 签名密钥；未配置时直接抛错，杜绝静默签发无法被网关验签的凭据
   */
  private requireTokenSecret(): string {
    const tokenSecret = this.config?.tokenSecret;
    if (!tokenSecret) {
      throw new Error('Centrifugo tokenSecret is not configured (check REALTIME_URL)');
    }
    return tokenSecret;
  }

  /**
   * 构造标准 Claims：sub(用户 ID) + exp(过期时间) + info(用户画像)
   */
  private buildTokenClaims(
    user: CurrentUserPayload,
    ttlSeconds: number,
  ): { claims: Record<string, unknown>; expiresAt: number } {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return {
      claims: {
        sub: String(user.id),
        exp,
        info: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      },
      expiresAt: exp * 1000,
    };
  }

  /**
   * 签发当前登录用户的长连接 Connection Token (JWT)
   * 客户端连接 Centrifugo 时在 Header/Query 携带，Centrifugo 本地验证 sub 声明。
   */
  generateConnectionToken(user: CurrentUserPayload, ttlSeconds = 86400): { token: string; expiresAt: number } {
    const tokenSecret = this.requireTokenSecret();
    const { claims, expiresAt } = this.buildTokenClaims(user, ttlSeconds);

    return { token: signHs256Jwt(claims, tokenSecret), expiresAt };
  }

  /**
   * 签发频道专属 Subscription Token (JWT)
   * 用于客户端订阅私有/在场频道时向 Centrifugo 提供准入凭据。
   */
  generateSubscriptionToken(
    user: CurrentUserPayload,
    channel: string,
    client?: string,
    ttlSeconds = 86400,
  ): { token: string; channel: string; expiresAt: number } {
    const tokenSecret = this.requireTokenSecret();
    const { claims, expiresAt } = this.buildTokenClaims(user, ttlSeconds);

    claims.channel = channel;
    if (client) {
      claims.client = client;
    }

    return { token: signHs256Jwt(claims, tokenSecret), channel, expiresAt };
  }

  /**
   * 向指定用户私有频道定向推送事件
   * Centrifugo 用户频道命名规范：user#<userId>
   */
  async sendToUser<T = unknown>(envelope: RealtimeEnvelope<T>): Promise<void> {
    if (!this.config || !envelope.targetUserId) {
      return;
    }

    const channel = RealtimeChannel.user(envelope.targetUserId);
    await this.callApi('publish', {
      channel,
      data: envelope,
    });
  }

  /**
   * 向指定频道广播事件
   */
  async broadcast<T = unknown>(envelope: RealtimeEnvelope<T>): Promise<void> {
    if (!this.config) {
      return;
    }

    const channel = envelope.channel ?? RealtimeChannel.public('default');
    await this.callApi('publish', {
      channel,
      data: envelope,
    });
  }

  /**
   * 批量发布广播事件（调度 Centrifugo 官方 batch HTTP API）
   * 单次 HTTP 往返向多个频道/用户分发消息，极大降低网络 IO 与 CPU 开销
   */
  async batchPublish(publications: { channel: string; data: unknown }[]): Promise<void> {
    if (!this.config || publications.length === 0) {
      return;
    }

    const commands = publications.map((pub) => ({
      publish: {
        channel: pub.channel,
        data: pub.data,
      },
    }));

    await this.callApi('batch', {
      commands,
      parallel: true,
    });
  }

  /**
   * 探测 Centrifugo 节点运行指标与存活状态（软依赖健康检查）
   */
  async checkHealth(): Promise<CentrifugoHealthStatus> {
    if (!this.config) {
      return buildUnavailableHealth('down', 'Centrifugo not configured (missing REALTIME_URL)');
    }

    try {
      const res = await this.callApi<{ nodes?: CentrifugoNodeInfo[] }>('info', {});

      if (!res?.nodes || res.nodes.length === 0) {
        return buildUnavailableHealth('degraded', 'Centrifugo returned empty node list');
      }

      const totalClients = res.nodes.reduce((acc, n) => acc + (n.num_clients || 0), 0);
      const totalChannels = res.nodes.reduce((acc, n) => acc + (n.num_channels || 0), 0);

      return {
        status: 'up',
        nodesCount: res.nodes.length,
        totalClients,
        totalChannels,
        version: res.nodes[0]?.version,
      };
    } catch (err) {
      return buildUnavailableHealth('down', (err as Error).message);
    }
  }

  /**
   * 查询指定频道的实时在场成员（Presence）
   */
  async getPresence<T = Record<string, unknown>>(channel: string): Promise<CentrifugoPresenceMember<T>[]> {
    if (!this.config) {
      return [];
    }

    try {
      const response = await this.callApi<{
        presence?: Record<string, { client: string; user: string; conn_info?: T; chan_info?: T }>;
      }>('presence', { channel });

      const presenceMap = response?.presence ?? {};
      return Object.values(presenceMap).map((item) => ({
        clientId: item.client,
        userId: item.user,
        info: (item.chan_info ?? item.conn_info ?? {}) as T,
      }));
    } catch (err) {
      this.logger.warn(
        `[CentrifugoTransport] Failed to fetch presence for channel ${channel}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 底层调度 Centrifugo HTTP Server API
   */
  private async callApi<R = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<R | null> {
    if (!this.config) {
      return null;
    }

    const endpoint = `${this.config.apiUrl}/${method}`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `apikey ${this.config.apiKey}`,
        },
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        this.logger.warn(`[CentrifugoTransport] API ${method} HTTP ${res.status}: ${errorText}`);
        return null;
      }

      const body = (await res.json()) as { result?: R; error?: { code: number; message: string } };
      if (body.error) {
        this.logger.warn(`[CentrifugoTransport] API ${method} error: [${body.error.code}] ${body.error.message}`);
        return null;
      }

      return body.result ?? null;
    } catch (err) {
      this.logger.warn(`[CentrifugoTransport] API request to ${method} failed: ${(err as Error).message}`);
      return null;
    }
  }
}
