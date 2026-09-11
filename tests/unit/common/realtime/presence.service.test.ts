import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PresenceService } from '@/common/realtime/channels/presence.service';
import type { PresenceMember } from '@/common/realtime/channels/presence.types';
import type { RedisService } from '@/database/redis.service';

describe('PresenceService', () => {
  describe('内存透明降级模式 (In-Memory Mode)', () => {
    let service: PresenceService;

    beforeEach(() => {
      service = new PresenceService(undefined);
    });

    it('join 应成功加入成员并标记 isNew，同一用户再次 join 返回 isNew=false', async () => {
      const member1: PresenceMember = {
        userId: 'user-1',
        userInfo: { name: 'Alice', role: 'user' },
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      };

      const res1 = await service.join('presence:room-1', member1, 60);
      expect(res1.isNew).toBe(true);
      expect(res1.member.userId).toBe('user-1');

      const members = await service.getMembers('presence:room-1');
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe('user-1');

      // 同一用户重复加入刷新信息
      const res2 = await service.join('presence:room-1', { ...member1, userInfo: { name: 'Alice 2' } }, 60);
      expect(res2.isNew).toBe(false);

      const membersAfter = await service.getMembers('presence:room-1');
      expect(membersAfter).toHaveLength(1);
      expect(membersAfter[0].userInfo.name).toBe('Alice 2');
    });

    it('leave 应正确从频道移除成员，不存在时返回 false', async () => {
      const member: PresenceMember = {
        userId: 'user-2',
        userInfo: { name: 'Bob' },
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      };

      await service.join('presence:room-2', member, 60);
      const removed = await service.leave('presence:room-2', 'user-2');
      expect(removed).toBe(true);

      const members = await service.getMembers('presence:room-2');
      expect(members).toHaveLength(0);

      const removedAgain = await service.leave('presence:room-2', 'user-2');
      expect(removedAgain).toBe(false);
    });

    it('heartbeat 应对已存在成员续约成功，对不存在成员返回 false', async () => {
      const member: PresenceMember = {
        userId: 'user-3',
        userInfo: { name: 'Charlie' },
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      };

      await service.join('presence:room-3', member, 60);

      const ok = await service.heartbeat('presence:room-3', 'user-3', 60);
      expect(ok).toBe(true);

      const notFound = await service.heartbeat('presence:room-3', 'non-existent', 60);
      expect(notFound).toBe(false);
    });

    it('getMember 应正确返回单个成员或 null', async () => {
      const member: PresenceMember = {
        userId: 'user-4',
        userInfo: { name: 'David' },
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      };

      await service.join('presence:room-4', member, 60);

      const found = await service.getMember('presence:room-4', 'user-4');
      expect(found?.userId).toBe('user-4');

      const notFound = await service.getMember('presence:room-4', 'user-other');
      expect(notFound).toBeNull();
    });

    it('租期到期后应自动从 getMembers 与 cleanExpired 中被剔除', async () => {
      vi.useFakeTimers();
      const member: PresenceMember = {
        userId: 'user-5',
        userInfo: { name: 'Eve' },
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      };

      await service.join('presence:room-5', member, 10); // 10s TTL
      expect(await service.getMembers('presence:room-5')).toHaveLength(1);

      // 快进 11 秒
      vi.advanceTimersByTime(11_000);

      const expiredMembers = await service.getMembers('presence:room-5');
      expect(expiredMembers).toHaveLength(0);

      vi.useRealTimers();
    });

    it('cleanExpired 应主动清理已过期的成员并返回其 ID 列表', async () => {
      vi.useFakeTimers();
      const member: PresenceMember = {
        userId: 'user-6',
        userInfo: { name: 'Frank' },
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      };

      await service.join('presence:room-6', member, 5);
      vi.advanceTimersByTime(6_000);

      const cleanedIds = await service.cleanExpired('presence:room-6');
      expect(cleanedIds).toEqual(['user-6']);

      vi.useRealTimers();
    });
  });

  describe('分布式 Redis 模式 (Redis Mode)', () => {
    let service: PresenceService;
    let mockClient: any;
    let mockRedisService: RedisService;

    beforeEach(() => {
      const pipelineMock = {
        hset: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        hdel: vi.fn().mockReturnThis(),
        del: vi.fn().mockReturnThis(),
        exists: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([[null, 1]]),
      };

      mockClient = {
        hexists: vi.fn().mockResolvedValue(0),
        hset: vi.fn().mockResolvedValue(1),
        hget: vi.fn(),
        hgetall: vi.fn().mockResolvedValue({}),
        hdel: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        pipeline: vi.fn().mockReturnValue(pipelineMock),
      };

      mockRedisService = {
        getClient: vi.fn().mockReturnValue(mockClient),
      } as unknown as RedisService;

      service = new PresenceService(mockRedisService);
    });

    it('join 应通过 pipeline 执行 hset 与 set 租期键', async () => {
      const member: PresenceMember = {
        userId: 'redis-user-1',
        userInfo: { name: 'Redis User' },
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      };

      const res = await service.join('presence:chat', member, 60);

      expect(res.isNew).toBe(true);
      expect(mockClient.hexists).toHaveBeenCalledWith('realtime:presence:presence:chat', 'redis-user-1');
      expect(mockClient.pipeline).toHaveBeenCalled();
    });

    it('leave 应通过 pipeline 同时 hdel 成员并 del 租期键', async () => {
      const pipelineInstance = mockClient.pipeline();
      pipelineInstance.exec.mockResolvedValue([
        [null, 1],
        [null, 1],
      ]);

      const left = await service.leave('presence:chat', 'redis-user-1');

      expect(left).toBe(true);
      expect(pipelineInstance.hdel).toHaveBeenCalledWith('realtime:presence:presence:chat', 'redis-user-1');
      expect(pipelineInstance.del).toHaveBeenCalledWith('realtime:presence:lease:presence:chat:redis-user-1');
    });

    it('heartbeat 应对有效 Hash 记录刷新并在 Redis 中续约', async () => {
      const existingMember: PresenceMember = {
        userId: 'redis-user-2',
        userInfo: { name: 'Heartbeat User' },
        joinedAt: Date.now() - 5000,
        updatedAt: Date.now() - 5000,
      };

      mockClient.hget.mockResolvedValue(JSON.stringify(existingMember));

      const refreshed = await service.heartbeat('presence:chat', 'redis-user-2', 60);

      expect(refreshed).toBe(true);
      expect(mockClient.hget).toHaveBeenCalledWith('realtime:presence:presence:chat', 'redis-user-2');
      expect(mockClient.pipeline).toHaveBeenCalled();
    });

    it('getMembers 应检测并自动过滤租期过期的幽灵成员', async () => {
      const activeMember: PresenceMember = {
        userId: 'active-1',
        userInfo: { name: 'Active User' },
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      };
      const ghostMember: PresenceMember = {
        userId: 'ghost-1',
        userInfo: { name: 'Ghost User' },
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockClient.hgetall.mockResolvedValue({
        'active-1': JSON.stringify(activeMember),
        'ghost-1': JSON.stringify(ghostMember),
      });

      const pipelineInstance = mockClient.pipeline();
      // active-1 exists -> 1, ghost-1 expired exists -> 0
      pipelineInstance.exec.mockResolvedValue([
        [null, 1],
        [null, 0],
      ]);

      const members = await service.getMembers('presence:chat');

      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe('active-1');
    });

    it('cleanExpired 在 Redis 模式下应正确清理租期已过期的幽灵成员', async () => {
      mockClient.hgetall.mockResolvedValue({
        'user-alive': JSON.stringify({ userId: 'user-alive' }),
        'user-dead': JSON.stringify({ userId: 'user-dead' }),
      });

      const pipelineInstance = mockClient.pipeline();
      // user-alive exists -> 1, user-dead expired exists -> 0
      pipelineInstance.exec.mockResolvedValue([
        [null, 1],
        [null, 0],
      ]);

      const expiredIds = await service.cleanExpired('presence:chat');

      expect(expiredIds).toEqual(['user-dead']);
      expect(pipelineInstance.hdel).toHaveBeenCalledWith('realtime:presence:presence:chat', 'user-dead');
    });

    it('cleanExpired 在 Redis 频道无成员时应直接返回空数组', async () => {
      mockClient.hgetall.mockResolvedValue({});

      const expiredIds = await service.cleanExpired('presence:empty');
      expect(expiredIds).toEqual([]);
    });

    it('当 Redis 操作抛出异常时，join/leave/heartbeat/getMembers 应记录警告并透明降级到内存模式', async () => {
      // 模拟 Redis 彻底宕机抛错
      mockClient.hexists.mockRejectedValue(new Error('ECONNREFUSED'));
      mockClient.pipeline.mockImplementation(() => {
        throw new Error('ECONNREFUSED');
      });
      mockClient.hgetall.mockRejectedValue(new Error('ECONNREFUSED'));
      mockClient.hget.mockRejectedValue(new Error('ECONNREFUSED'));

      const fallbackMember: PresenceMember = {
        userId: 'fallback-user-1',
        userInfo: { name: 'Fallback User' },
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      };

      // 1. join 降级到内存
      const joinRes = await service.join('presence:degraded', fallbackMember, 60);
      expect(joinRes.isNew).toBe(true);
      expect(joinRes.member.userId).toBe('fallback-user-1');

      // 2. getMembers 降级从内存读取
      const members = await service.getMembers('presence:degraded');
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe('fallback-user-1');

      // 3. heartbeat 降级在内存续约
      const hbOk = await service.heartbeat('presence:degraded', 'fallback-user-1', 60);
      expect(hbOk).toBe(true);

      // 4. leave 降级在内存移除
      const leaveOk = await service.leave('presence:degraded', 'fallback-user-1');
      expect(leaveOk).toBe(true);

      const membersAfter = await service.getMembers('presence:degraded');
      expect(membersAfter).toHaveLength(0);
    });
  });

  describe('Centrifugo 驱动代理模式 (Centrifugo Mode)', () => {
    it('当 BROADCAST_DRIVER 为 centrifugo 时应通过 CentrifugoTransport 获取在场成员并正确映射', async () => {
      const mockConfigService = {
        get: vi.fn().mockReturnValue('centrifugo'),
      } as any;

      const mockCentrifugoTransport = {
        getPresence: vi.fn().mockResolvedValue([
          {
            userId: 'user-centrifugo-1',
            clientId: 'client-conn-999',
            info: { name: 'Centrifugo User', role: 'admin' },
          },
        ]),
      } as any;

      const service = new PresenceService(undefined, mockConfigService, mockCentrifugoTransport);

      const members = await service.getMembers('presence:room-1');

      expect(mockCentrifugoTransport.getPresence).toHaveBeenCalledWith('presence:room-1');
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({
        userId: 'user-centrifugo-1',
        clientId: 'client-conn-999',
        userInfo: { name: 'Centrifugo User', role: 'admin' },
      });
      expect(typeof members[0].joinedAt).toBe('number');
      expect(typeof members[0].updatedAt).toBe('number');
    });
  });
});
