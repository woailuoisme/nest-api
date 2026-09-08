import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PusherTransport, parsePusherDsn, toPusherChannel } from '@/realtime/transports/pusher.transport';

describe('PusherTransport & parsePusherDsn', () => {
  it('parsePusherDsn 应正确解析包含凭据与参数的 Pusher/Soketi DSN', () => {
    const dsn = 'pusher://my-key:my-secret@127.0.0.1:6001/app123?cluster=ap1&useTls=true';
    const config = parsePusherDsn(dsn);

    expect(config).toEqual({
      appId: 'app123',
      key: 'my-key',
      secret: 'my-secret',
      host: '127.0.0.1',
      port: 6001,
      useTLS: true,
      cluster: 'ap1',
    });
  });

  describe('toPusherChannel 标准化', () => {
    it('应将 private: 转换为 private-', () => {
      expect(toPusherChannel('private:user.42')).toBe('private-user.42');
    });

    it('应将 presence: 转换为 presence-', () => {
      expect(toPusherChannel('presence:chat.room1')).toBe('presence-chat.room1');
    });

    it('公开频道保持不变', () => {
      expect(toPusherChannel('dashboard:system')).toBe('dashboard:system');
    });
  });

  describe('PusherTransport', () => {
    let transport: PusherTransport;
    let mockClient: {
      trigger: ReturnType<typeof vi.fn>;
      authorizeChannel: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockClient = {
        trigger: vi.fn().mockResolvedValue({}),
        authorizeChannel: vi.fn().mockReturnValue({ auth: 'my-key:mock-sig' }),
      };

      const configService = {
        get: vi.fn().mockReturnValue('pusher://my-key:my-secret@127.0.0.1:6001/app123'),
      } as unknown as ConfigService<any, true>;

      transport = new PusherTransport(configService);
      (transport as any).client = mockClient;
    });

    it('sendToUser 应向 private-user.{id} 频道投递', async () => {
      await transport.sendToUser({
        event: 'order:status',
        targetUserId: '01931234-0000-7000-8000-000000000042',
        data: { status: 'paid' },
        timestamp: Date.now(),
      });

      expect(mockClient.trigger).toHaveBeenCalledWith(
        'private-user.01931234-0000-7000-8000-000000000042',
        'order:status',
        { status: 'paid' },
      );
    });

    it('broadcast 应将 private: 与 presence: 规范化为 Pusher 前缀后向目标频道广播', async () => {
      await transport.broadcast({
        event: 'order:shipped',
        channel: 'private:orders.999',
        data: { carrier: 'SF' },
        timestamp: Date.now(),
      });

      expect(mockClient.trigger).toHaveBeenCalledWith('private-orders.999', 'order:shipped', { carrier: 'SF' });

      await transport.broadcast({
        event: 'user:joined',
        channel: 'presence:meeting.room',
        data: { userId: 42 },
        timestamp: Date.now(),
      });

      expect(mockClient.trigger).toHaveBeenCalledWith('presence-meeting.room', 'user:joined', { userId: 42 });
    });

    it('authorizeChannel 应委托底层 Pusher 客户端计算合法签名', () => {
      const sig = transport.authorizeChannel('123.456', 'private:user.42');

      expect(mockClient.authorizeChannel).toHaveBeenCalledWith('123.456', 'private-user.42', undefined);
      expect(sig).toEqual({ auth: 'my-key:mock-sig' });
    });
  });
});
