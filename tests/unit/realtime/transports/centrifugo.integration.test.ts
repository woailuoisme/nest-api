import type { ConfigService } from '@nestjs/config';
import { beforeAll, describe, expect, it } from 'vitest';

import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ChannelManager } from '@/realtime/channels/channel-manager.service';
import { PresenceService } from '@/realtime/channels/presence.service';
import { RealtimeService } from '@/realtime/realtime.service';
import { CentrifugoTransport } from '@/realtime/transports/centrifugo.transport';

const REALTIME_TEST_DSN =
  process.env.REALTIME_URL ||
  'centrifugo://aef5a17a-fdeb-48aa-b2c1-d490c62ff950:768583f3-7205-4b36-aea3-32ca8dea4914@127.0.0.1:8000/api';

describe('Centrifugo 容器真实集成测试 (Live Integration)', () => {
  let isCentrifugoOnline = false;
  let transport: CentrifugoTransport;
  let realtimeService: RealtimeService;

  const mockUser: CurrentUserPayload = {
    id: '01931234-0000-7000-8000-000000000001',
    email: 'integration-test@example.com',
    role: Role.USER,
  };

  beforeAll(async () => {
    // 探测本地 Centrifugo 容器是否健康在线
    try {
      const res = await fetch('http://127.0.0.1:8000/health', { method: 'GET' });
      if (res.ok) {
        isCentrifugoOnline = true;
      }
    } catch {
      isCentrifugoOnline = false;
    }

    const mockConfigService = {
      get: (key: string) => {
        if (key === 'REALTIME_URL') return REALTIME_TEST_DSN;
        return undefined;
      },
    } as unknown as ConfigService<any, true>;

    transport = new CentrifugoTransport(mockConfigService);
    const channelManager = new ChannelManager();

    realtimeService = new RealtimeService(transport, channelManager, transport);
  });

  it('真实探测 Centrifugo 集群节点健康状态 (checkHealth)', async () => {
    if (!isCentrifugoOnline) {
      console.warn('[Centrifugo Integration] Centrifugo container is offline, skipping live test.');
      return;
    }

    const health = await transport.checkHealth();
    expect(health.status).toBe('up');
    expect(health.nodesCount).toBeGreaterThanOrEqual(1);
    expect(health.version).toBeDefined();
    expect(typeof health.totalClients).toBe('number');
    expect(typeof health.totalChannels).toBe('number');
  });

  it('真实签发 Connection Token 并验证 JWT 签名格式', () => {
    const { token, expiresAt } = transport.generateConnectionToken(mockUser, 3600);

    expect(token).toBeDefined();
    expect(expiresAt).toBeGreaterThan(Date.now());

    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    expect(payload.sub).toBe(mockUser.id);
    expect(payload.info.email).toBe(mockUser.email);
  });

  it('真实签发 Subscription Token 并在 payload 包含客户端信息', () => {
    const { token, channel, expiresAt } = transport.generateSubscriptionToken(
      mockUser,
      'private:orders.123',
      'client-test-abc',
      1800,
    );

    expect(channel).toBe('private:orders.123');
    expect(expiresAt).toBeGreaterThan(Date.now());

    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    expect(payload.channel).toBe('private:orders.123');
    expect(payload.client).toBe('client-test-abc');
  });

  it('向 Centrifugo 发起真实的公共频道广播 (broadcast)', async () => {
    if (!isCentrifugoOnline) return;

    await expect(
      transport.broadcast({
        event: 'integration:test_event',
        channel: 'public:live_test',
        data: { message: 'Hello from nestjs integration test', sentAt: Date.now() },
        timestamp: Date.now(),
      }),
    ).resolves.toBeUndefined();
  });

  it('向 Centrifugo 发起真实的用户频道私信推送 (sendToUser)', async () => {
    if (!isCentrifugoOnline) return;

    await expect(
      transport.sendToUser({
        event: 'notification:created',
        targetUserId: mockUser.id,
        data: { id: 'notif-1', title: 'Test Alert' },
        timestamp: Date.now(),
      }),
    ).resolves.toBeUndefined();
  });

  it('向 Centrifugo 发起真实的批量并发发布 (batchPublish)', async () => {
    if (!isCentrifugoOnline) return;

    await expect(
      transport.batchPublish([
        { channel: 'public:events', data: { seq: 1 } },
        { channel: 'public:events', data: { seq: 2 } },
        { channel: `user#${mockUser.id}`, data: { direct: true } },
      ]),
    ).resolves.toBeUndefined();
  });

  it('通过 RealtimeService 端到端分发真实广播并进行健康检查', async () => {
    if (!isCentrifugoOnline) return;

    // 1. 通过 RealtimeService 发送广播
    const envelope = await realtimeService.broadcast('public:chat', 'chat:message', {
      content: 'RealtimeService live integration broadcast',
    });
    expect(envelope.event).toBe('chat:message');
    expect(envelope.channel).toBe('public:chat');

    // 2. 查询在场成员（room 频道在 config.yaml 中已开启 presence）
    const presenceMembers = await transport.getPresence('room:lobby');
    expect(Array.isArray(presenceMembers)).toBe(true);

    // 3. 健康检查
    const health = await realtimeService.checkHealth();
    expect(health.status).toBe('up');
    expect(health.nodesCount).toBeGreaterThanOrEqual(1);
  });
});
