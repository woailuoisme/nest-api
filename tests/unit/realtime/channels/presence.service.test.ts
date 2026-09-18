import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PresenceService } from '@/realtime/channels/presence.service';
import type { PresenceMember } from '@/realtime/channels/presence.types';
import type { CentrifugoTransport } from '@/realtime/transports/centrifugo.transport';

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

  describe('Centrifugo 原生在场代理模式 (Centrifugo Mode)', () => {
    it('应直接委托 CentrifugoTransport 获取在场成员并正确映射结构', async () => {
      const mockCentrifugoTransport = {
        getPresence: vi.fn().mockResolvedValue([
          {
            userId: 'user-centrifugo-1',
            clientId: 'client-conn-999',
            info: { name: 'Centrifugo User', role: 'admin' },
          },
        ]),
      } as unknown as CentrifugoTransport;

      const service = new PresenceService(mockCentrifugoTransport);

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

    it('getMember 应在 Centrifugo 模式下准确返回匹配的在场成员', async () => {
      const mockCentrifugoTransport = {
        getPresence: vi.fn().mockResolvedValue([
          {
            userId: 'user-centrifugo-1',
            clientId: 'client-conn-999',
            info: { name: 'Centrifugo User' },
          },
        ]),
      } as unknown as CentrifugoTransport;

      const service = new PresenceService(mockCentrifugoTransport);

      const found = await service.getMember('presence:room-1', 'user-centrifugo-1');
      expect(found).not.toBeNull();
      expect(found?.userId).toBe('user-centrifugo-1');

      const notFound = await service.getMember('presence:room-1', 'user-other');
      expect(notFound).toBeNull();
    });
  });
});
