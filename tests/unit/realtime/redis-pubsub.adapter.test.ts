import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RedisService } from '@/database/redis.service';
import { RedisPubSubAdapter } from '@/realtime/transports/redis-pubsub.adapter';

describe('RedisPubSubAdapter', () => {
  let adapter: RedisPubSubAdapter;
  let mockRedisClient: {
    duplicate: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
  };
  let mockSubClient: {
    subscribe: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
    quit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSubClient = {
      subscribe: vi.fn().mockResolvedValue('OK'),
      on: vi.fn(),
      unsubscribe: vi.fn().mockResolvedValue('OK'),
      quit: vi.fn().mockResolvedValue('OK'),
    };
    mockRedisClient = {
      duplicate: vi.fn().mockReturnValue(mockSubClient),
      publish: vi.fn().mockResolvedValue(1),
    };

    const redisService = {
      getClient: vi.fn().mockReturnValue(mockRedisClient),
    } as unknown as RedisService;

    adapter = new RedisPubSubAdapter(redisService);
  });

  it('onModuleInit 应创建副本客户端并订阅集群频道', async () => {
    await adapter.onModuleInit();

    expect(mockRedisClient.duplicate).toHaveBeenCalled();
    expect(mockSubClient.subscribe).toHaveBeenCalledWith('realtime:cluster:events');
    expect(mockSubClient.on).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('publish 应将事件包装 originPodId 后写入 Redis 频道', async () => {
    await adapter.publish({
      event: 'user:login',
      targetUserId: 1,
      data: { ip: '127.0.0.1' },
      timestamp: Date.now(),
    });

    expect(mockRedisClient.publish).toHaveBeenCalledWith(
      'realtime:cluster:events',
      expect.stringContaining('"event":"user:login"'),
    );
  });

  it('handleClusterMessage 应转发异构节点事件并过滤自身节点事件', async () => {
    await adapter.onModuleInit();

    const forwarder = vi.fn();
    adapter.setForwarder(forwarder);

    // 获取 message 监听回调
    const messageHandler = mockSubClient.on.mock.calls.find((call) => call[0] === 'message')?.[1];
    expect(messageHandler).toBeDefined();

    // 1. 异构 Pod 发送的消息
    messageHandler(
      'realtime:cluster:events',
      JSON.stringify({
        originPodId: 'remote-pod-999',
        event: 'order:created',
        data: { id: 1 },
        timestamp: Date.now(),
      }),
    );
    expect(forwarder).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'order:created',
        data: { id: 1 },
      }),
    );

    forwarder.mockClear();

    // 2. 本地 Pod 自身发送的消息（通过反射注入自身 podId 测试去重）
    const selfPodId = (adapter as any).podId;
    messageHandler(
      'realtime:cluster:events',
      JSON.stringify({
        originPodId: selfPodId,
        event: 'order:created',
        data: { id: 2 },
        timestamp: Date.now(),
      }),
    );
    expect(forwarder).not.toHaveBeenCalled();
  });
});
