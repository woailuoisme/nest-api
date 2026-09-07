import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeGateway } from '@/realtime/realtime.gateway';
import { LocalCompositeTransport } from '@/realtime/transports/local-composite.transport';
import type { RedisPubSubAdapter } from '@/realtime/transports/redis-pubsub.adapter';
import type { SseTransport } from '@/realtime/transports/sse.transport';

describe('LocalCompositeTransport', () => {
  let transport: LocalCompositeTransport;
  let sseTransport: {
    sendToUser: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
  };
  let realtimeGateway: {
    sendToUser: ReturnType<typeof vi.fn>;
    broadcast: ReturnType<typeof vi.fn>;
  };
  let redisAdapter: {
    publish: ReturnType<typeof vi.fn>;
    setForwarder: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    sseTransport = {
      sendToUser: vi.fn(),
      broadcast: vi.fn(),
    };
    realtimeGateway = {
      sendToUser: vi.fn(),
      broadcast: vi.fn(),
    };
    redisAdapter = {
      publish: vi.fn().mockResolvedValue(undefined),
      setForwarder: vi.fn(),
    };

    transport = new LocalCompositeTransport(
      sseTransport as unknown as SseTransport,
      realtimeGateway as unknown as RealtimeGateway,
      redisAdapter as unknown as RedisPubSubAdapter,
    );
  });

  it('onModuleInit 应向 Redis 适配器注册消息转发器', () => {
    transport.onModuleInit();
    expect(redisAdapter.setForwarder).toHaveBeenCalledWith(expect.any(Function));
  });

  it('sendToUser 应同时向 SSE 和 WebSocket 派发并发布到 Redis', async () => {
    const envelope = {
      event: 'user:alert',
      targetUserId: 10,
      data: { msg: 'test' },
      timestamp: Date.now(),
    };

    await transport.sendToUser(envelope);

    expect(sseTransport.sendToUser).toHaveBeenCalledWith(envelope);
    expect(realtimeGateway.sendToUser).toHaveBeenCalledWith(envelope);
    expect(redisAdapter.publish).toHaveBeenCalledWith(envelope);
  });

  it('broadcast 应同时向 SSE 和 WebSocket 广播并发布到 Redis', async () => {
    const envelope = {
      event: 'system:ping',
      channel: 'system',
      data: { now: 123 },
      timestamp: Date.now(),
    };

    await transport.broadcast(envelope);

    expect(sseTransport.broadcast).toHaveBeenCalledWith(envelope);
    expect(realtimeGateway.broadcast).toHaveBeenCalledWith(envelope);
    expect(redisAdapter.publish).toHaveBeenCalledWith(envelope);
  });

  it('Redis 转发器收到集群事件时应直接在本地双通道分发而不再触发 Redis 发布', () => {
    let capturedForwarder: ((envelope: any) => void) | null = null;
    redisAdapter.setForwarder.mockImplementation((fn) => {
      capturedForwarder = fn;
    });

    transport.onModuleInit();
    expect(capturedForwarder).toBeTypeOf('function');

    const clusterEnvelope = {
      event: 'order:created',
      channel: 'orders',
      data: { id: 1 },
      timestamp: Date.now(),
    };

    redisAdapter.publish.mockClear();
    capturedForwarder!(clusterEnvelope);

    expect(sseTransport.broadcast).toHaveBeenCalledWith(clusterEnvelope);
    expect(realtimeGateway.broadcast).toHaveBeenCalledWith(clusterEnvelope);
    // 关键断言：不得再次调用 redis.publish 导致无限回环
    expect(redisAdapter.publish).not.toHaveBeenCalled();
  });
});
