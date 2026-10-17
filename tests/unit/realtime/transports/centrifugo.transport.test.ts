import * as crypto from 'node:crypto';

import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { PresenceService } from '@/realtime/channels/presence.service';
import { CentrifugoTransport, parseCentrifugoDsn, signHs256Jwt } from '@/realtime/transports/centrifugo.transport';

describe('CentrifugoTransport', () => {
  describe('parseCentrifugoDsn()', () => {
    it('应准确解析标准 HTTP DSN 配置', () => {
      const dsn = 'centrifugo://api-key-1:token-secret-2@127.0.0.1:8000/api?tls=false';
      const config = parseCentrifugoDsn(dsn);

      expect(config).toEqual({
        apiKey: 'api-key-1',
        tokenSecret: 'token-secret-2',
        apiUrl: 'http://127.0.0.1:8000/api',
        host: '127.0.0.1',
        port: 8000,
        useTLS: false,
      });
    });

    it('应正确解析启用 TLS 且缺省端口的 HTTPS DSN', () => {
      const dsn = 'centrifugo://cluster-admin:super-secret@realtime.example.com/centrifugo?useTls=true';
      const config = parseCentrifugoDsn(dsn);

      expect(config.useTLS).toBe(true);
      expect(config.port).toBe(443);
      expect(config.apiUrl).toBe('https://realtime.example.com/centrifugo');
    });

    it('应自动 URL 解码包含特殊字符的 API Key 与 Token Secret', () => {
      const dsn = 'centrifugo://admin%3Akey:token%40secret%24@localhost:8000';
      const config = parseCentrifugoDsn(dsn);

      expect(config.apiKey).toBe('admin:key');
      expect(config.tokenSecret).toBe('token@secret$');
      expect(config.apiUrl).toBe('http://localhost:8000/api');
    });
  });

  describe('signHs256Jwt()', () => {
    it('应生成结构合法的 HS256 JWT 并通过密码学校验', () => {
      const payload = { sub: 'user-123', role: 'admin', exp: 1720000000 };
      const secret = 'test-secret-key-32-bytes-long-12345';

      const token = signHs256Jwt(payload, secret);
      const parts = token.split('.');
      expect(parts).toHaveLength(3);

      const [headerB64, payloadB64, sigB64] = parts;

      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });

      const decodedPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      expect(decodedPayload).toEqual(payload);

      // 验证 HMAC 签名
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(`${headerB64}.${payloadB64}`);
      const expectedSig = hmac.digest().toString('base64url');
      expect(sigB64).toBe(expectedSig);
    });
  });

  describe('Transport 实例方法与 API 调用', () => {
    let transport: CentrifugoTransport;
    let mockConfigService: { get: ReturnType<typeof vi.fn> };
    const mockUser: CurrentUserPayload = {
      id: '01931234-0000-7000-8000-000000000001',
      email: 'alex@example.com',
      role: Role.USER,
    };

    beforeEach(() => {
      mockConfigService = {
        get: vi.fn().mockImplementation((key: string) => {
          if (key === 'REALTIME_URL') {
            return 'centrifugo://my-api-key:my-token-secret@127.0.0.1:8000/api';
          }
          return undefined;
        }),
      };

      transport = new CentrifugoTransport(mockConfigService as unknown as ConfigService<any, true>);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('当 REALTIME_URL 未配置时，config 应为 null 且 sendToUser/broadcast/batchPublish 不应发起请求', async () => {
      const emptyConfigService = {
        get: vi.fn().mockReturnValue(undefined),
      };
      const unconfiguredTransport = new CentrifugoTransport(emptyConfigService as unknown as ConfigService<any, true>);
      expect(unconfiguredTransport.getConfig()).toBeNull();

      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await unconfiguredTransport.sendToUser({
        event: 'test',
        targetUserId: 'user-1',
        data: {},
        timestamp: Date.now(),
      });
      await unconfiguredTransport.broadcast({
        event: 'test',
        data: {},
        timestamp: Date.now(),
      });
      await unconfiguredTransport.batchPublish([{ channel: 'chan', data: {} }]);
      const presence = await unconfiguredTransport.getPresence('chan');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(presence).toEqual([]);
    });

    it('当 REALTIME_URL 格式非法时，应捕获异常且 config 保持为 null', () => {
      const invalidConfigService = {
        get: vi.fn().mockReturnValue('invalid-url-format'),
      };
      const badTransport = new CentrifugoTransport(invalidConfigService as unknown as ConfigService<any, true>);
      expect(badTransport.getConfig()).toBeNull();
    });

    it('当未配置 tokenSecret 时，generateConnectionToken 应抛出异常', () => {
      const noSecretConfigService = {
        get: vi.fn().mockReturnValue(undefined),
      };
      const badTransport = new CentrifugoTransport(noSecretConfigService as unknown as ConfigService<any, true>);
      expect(() => badTransport.generateConnectionToken(mockUser)).toThrowError(
        /Centrifugo tokenSecret is not configured/,
      );
    });

    it('当未配置 tokenSecret 时，generateSubscriptionToken 应抛出异常', () => {
      const noSecretConfigService = {
        get: vi.fn().mockReturnValue(undefined),
      };
      const badTransport = new CentrifugoTransport(noSecretConfigService as unknown as ConfigService<any, true>);
      expect(() => badTransport.generateSubscriptionToken(mockUser, 'channel-1')).toThrowError(
        /Centrifugo tokenSecret is not configured/,
      );
    });

    it('generateConnectionToken 应签发合法的长连接 JWT', () => {
      const { token, expiresAt } = transport.generateConnectionToken(mockUser, 3600);
      expect(token).toBeDefined();
      expect(expiresAt).toBeGreaterThan(Date.now());

      const [, payloadB64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      expect(payload.sub).toBe(mockUser.id);
      expect(payload.info).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
    });

    it('generateSubscriptionToken 应签发合法的频道订阅 JWT', () => {
      const { token, channel, expiresAt } = transport.generateSubscriptionToken(
        mockUser,
        'private:chat.room-1',
        'client-xyz-789',
        1800,
      );

      expect(channel).toBe('private:chat.room-1');
      expect(expiresAt).toBeGreaterThan(Date.now());

      const [, payloadB64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      expect(payload.sub).toBe(mockUser.id);
      expect(payload.channel).toBe('private:chat.room-1');
      expect(payload.client).toBe('client-xyz-789');
    });

    it('sendToUser 缺少 targetUserId 时应直接跳过不调用 fetch', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await transport.sendToUser({
        event: 'order:shipped',
        data: { orderId: '1001' },
        timestamp: 1720000000000,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sendToUser 应向 user#<userId> 频道调用 Centrifugo publish API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ result: {} }),
      } as Response);

      await transport.sendToUser({
        event: 'order:shipped',
        targetUserId: mockUser.id,
        data: { orderId: '1001' },
        timestamp: 1720000000000,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:8000/api/publish',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'apikey my-api-key',
          },
          body: JSON.stringify({
            channel: `user#${mockUser.id}`,
            data: {
              event: 'order:shipped',
              targetUserId: mockUser.id,
              data: { orderId: '1001' },
              timestamp: 1720000000000,
            },
          }),
        }),
      );
    });

    it('broadcast 当未指定 channel 时应默认广播到 public:default', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ result: {} }),
      } as Response);

      await transport.broadcast({
        event: 'system:ping',
        data: { status: 'alive' },
        timestamp: 1720000000000,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:8000/api/publish',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            channel: 'public:default',
            data: {
              event: 'system:ping',
              data: { status: 'alive' },
              timestamp: 1720000000000,
            },
          }),
        }),
      );
    });

    it('broadcast 应向指定频道调用 Centrifugo publish API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ result: {} }),
      } as Response);

      await transport.broadcast({
        event: 'system:alert',
        channel: 'announcements',
        data: { text: 'Maintenance scheduled' },
        timestamp: 1720000000000,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:8000/api/publish',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            channel: 'announcements',
            data: {
              event: 'system:alert',
              channel: 'announcements',
              data: { text: 'Maintenance scheduled' },
              timestamp: 1720000000000,
            },
          }),
        }),
      );
    });

    it('callApi 在 HTTP 状态码非 200 时应记录警告并返回 null', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden permission denied',
      } as Response);

      // broadcast 内部会调用 callApi
      await expect(
        transport.broadcast({
          event: 'test',
          data: {},
          timestamp: Date.now(),
        }),
      ).resolves.toBeUndefined();
    });

    it('callApi 在 Centrifugo 返回业务错误码时应记录警告并返回 null', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          error: {
            code: 100,
            message: 'Namespace not found',
          },
        }),
      } as Response);

      await expect(
        transport.broadcast({
          event: 'test',
          data: {},
          timestamp: Date.now(),
        }),
      ).resolves.toBeUndefined();
    });

    it('getPresence 应成功返回在线客户端并兼容 conn_info 与 chan_info', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            presence: {
              'client-aaa': {
                client: 'client-aaa',
                user: 'user-001',
                conn_info: { name: 'Alice' },
              },
              'client-bbb': {
                client: 'client-bbb',
                user: 'user-002',
                chan_info: { name: 'Bob' },
              },
            },
          },
        }),
      } as Response);

      const members = await transport.getPresence('presence:room-1');

      expect(members).toHaveLength(2);
      expect(members[0]).toEqual({
        clientId: 'client-aaa',
        userId: 'user-001',
        info: { name: 'Alice' },
      });
      expect(members[1]).toEqual({
        clientId: 'client-bbb',
        userId: 'user-002',
        info: { name: 'Bob' },
      });
    });

    it('getPresence 在网络异常或服务端报错时应安全降级返回空数组', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

      const members = await transport.getPresence('presence:room-1');
      expect(members).toEqual([]);
    });

    it('batchPublish 应向 /api/batch 批量提交 publish 指令', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ result: { replies: [{}, {}] } }),
      } as Response);

      await transport.batchPublish([
        { channel: 'public:announcements', data: { text: 'Hello' } },
        { channel: 'user#user-1', data: { text: 'Hi' } },
      ]);

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:8000/api/batch',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'apikey my-api-key',
          }),
          body: JSON.stringify({
            commands: [
              { publish: { channel: 'public:announcements', data: { text: 'Hello' } } },
              { publish: { channel: 'user#user-1', data: { text: 'Hi' } } },
            ],
            parallel: true,
          }),
        }),
      );
    });

    it('batchPublish 传入空数组时应直接返回且不触发网络请求', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await transport.batchPublish([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('checkHealth 未配置 config 时应返回 down 状态及错误说明', async () => {
      const emptyConfigService = {
        get: vi.fn().mockReturnValue(undefined),
      };
      const unconfiguredTransport = new CentrifugoTransport(emptyConfigService as unknown as ConfigService<any, true>);

      const health = await unconfiguredTransport.checkHealth();
      expect(health.status).toBe('down');
      expect(health.error).toContain('missing REALTIME_URL');
    });

    it('checkHealth 当 Centrifugo 节点列表为空时应返回 degraded 状态', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            nodes: [],
          },
        }),
      } as Response);

      const health = await transport.checkHealth();
      expect(health.status).toBe('degraded');
      expect(health.nodesCount).toBe(0);
      expect(health.error).toContain('empty node list');
    });

    it('checkHealth 正常时应返回健康状态及节点、客户端与频道统计指标', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            nodes: [
              {
                num_clients: 12,
                num_channels: 4,
                version: '5.4.0',
              },
            ],
          },
        }),
      } as Response);

      const health = await transport.checkHealth();
      expect(health).toEqual({
        status: 'up',
        nodesCount: 1,
        totalClients: 12,
        totalChannels: 4,
        version: '5.4.0',
      });
    });

    it('checkHealth 当底层网络请求异常导致 callApi 返回 null 时应安全捕获并标记 degraded', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

      const health = await transport.checkHealth();
      expect(health.status).toBe('degraded');
      expect(health.nodesCount).toBe(0);
      expect(health.error).toBeDefined();
    });

    it('checkHealth 当发生未知异常时应捕获并标记 down', async () => {
      vi.spyOn(transport as any, 'callApi').mockRejectedValue(new Error('Unexpected system error'));

      const health = await transport.checkHealth();
      expect(health.status).toBe('down');
      expect(health.nodesCount).toBe(0);
      expect(health.error).toBe('Unexpected system error');
    });

    it('getWsUrl 与 getSseUrl 应支持显式 CENTRIFUGO_PUBLIC_* 配置覆盖', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'CENTRIFUGO_PUBLIC_WS_URL') return 'wss://custom.example.com/ws';
        if (key === 'CENTRIFUGO_PUBLIC_SSE_URL') return 'https://custom.example.com/sse';
        return undefined;
      });

      expect(transport.getWsUrl()).toBe('wss://custom.example.com/ws');
      expect(transport.getSseUrl()).toBe('https://custom.example.com/sse');
    });

    it('getWsUrl 与 getSseUrl 未配置显式地址时应从 REALTIME_URL 自动推导', () => {
      expect(transport.getWsUrl()).toBe('ws://127.0.0.1:8000/connection/websocket');
      expect(transport.getSseUrl()).toBe('http://127.0.0.1:8000/connection/sse');
    });

    it('当启用 TLS 且使用标准端口 443 时，自动推导应省略端口并使用 wss/https 协议', () => {
      const tlsConfigService = {
        get: vi.fn().mockImplementation((key: string) => {
          if (key === 'REALTIME_URL') return 'centrifugo://k:s@realtime.example.com/api?tls=true';
          return undefined;
        }),
      };
      const tlsTransport = new CentrifugoTransport(tlsConfigService as unknown as ConfigService<any, true>);
      expect(tlsTransport.getWsUrl()).toBe('wss://realtime.example.com/connection/websocket');
      expect(tlsTransport.getSseUrl()).toBe('https://realtime.example.com/connection/sse');
    });

    it('当未配置任何 REALTIME_URL 时，getWsUrl 与 getSseUrl 应安全降级至默认 8000 地址', () => {
      const emptyConfigService = {
        get: vi.fn().mockReturnValue(undefined),
      };
      const unconfigured = new CentrifugoTransport(emptyConfigService as unknown as ConfigService<any, true>);
      expect(unconfigured.getWsUrl()).toBe('ws://127.0.0.1:8000/connection/websocket');
      expect(unconfigured.getSseUrl()).toBe('http://127.0.0.1:8000/connection/sse');
    });
  });

  describe('PresenceService Centrifugo 多态委托集成', () => {
    it('当 BROADCAST_DRIVER 为 centrifugo 时应委托 transport.getPresence', async () => {
      const mockConfigService = {
        get: vi.fn().mockImplementation((key: string) => {
          if (key === 'BROADCAST_DRIVER') return 'centrifugo';
          if (key === 'REALTIME_URL') return 'centrifugo://k:s@127.0.0.1:8000/api';
          return undefined;
        }),
      };

      const transport = new CentrifugoTransport(mockConfigService as unknown as ConfigService<any, true>);
      vi.spyOn(transport, 'getPresence').mockResolvedValue([
        {
          clientId: 'client-99',
          userId: 'user-99',
          info: { name: 'David', role: 'admin' },
        },
      ]);

      const presenceService = new PresenceService(transport);

      const members = await presenceService.getMembers('presence:room-demo');

      expect(transport.getPresence).toHaveBeenCalledWith('presence:room-demo');
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe('user-99');
      expect(members[0].userInfo).toEqual({ name: 'David', role: 'admin' });
      expect(members[0].joinedAt).toBeDefined();
    });
  });
});
