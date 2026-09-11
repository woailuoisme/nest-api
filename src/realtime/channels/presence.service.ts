import { Injectable, Logger, Optional } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '@/config/env.validation';
import { RedisService } from '@/database/redis.service';
import { CentrifugoTransport } from '../transports/centrifugo.transport';
import { DEFAULT_PRESENCE_TTL_SECONDS, type PresenceMember, type PresenceMemberInfo } from './presence.types';

interface InMemoryLeaseItem<T = PresenceMemberInfo> {
  member: PresenceMember<T>;
  expiresAt: number;
}

/**
 * 分布式 Presence 状态感知服务
 *
 * 核心特性：
 * 1. 分布式租期保活：Redis Hash 存储频道全员元数据 + Redis String 附带 TTL 作为活跃租期；
 * 2. 幽灵成员自动剔除：读取/定时巡检时批量校对 Lease Key，自动回收异常断连的残留成员；
 * 3. 内存透明降级：Redis 未配置或单测环境下自动降级为全功能本地内存存储，保证 100% 稳定性与可测性；
 * 4. Centrifugo 多态委托：在 centrifugo 独立网关驱动下，自动透明委托其 HTTP API 查询集群实时在场。
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  /** 内存降级存储：channel -> userId -> { member, expiresAt } */
  private readonly memoryStore = new Map<string, Map<string, InMemoryLeaseItem>>();

  constructor(
    @Optional() private readonly redisService?: RedisService,
    @Optional() private readonly configService?: ConfigService<EnvConfig, true>,
    @Optional() private readonly centrifugoTransport?: CentrifugoTransport,
  ) {}

  private getPresenceKey(channel: string): string {
    return `realtime:presence:${channel}`;
  }

  private getLeaseKey(channel: string, userId: string): string {
    return `realtime:presence:lease:${channel}:${userId}`;
  }

  private getRedisClient() {
    const client = this.redisService?.getClient();
    return client && typeof client.pipeline === 'function' ? client : null;
  }

  /**
   * 成员加入 Presence 频道
   */
  async join<T = PresenceMemberInfo>(
    channel: string,
    member: PresenceMember<T>,
    ttlSeconds: number = DEFAULT_PRESENCE_TTL_SECONDS,
  ): Promise<{ isNew: boolean; member: PresenceMember<T> }> {
    const client = this.getRedisClient();

    if (client) {
      try {
        const presenceKey = this.getPresenceKey(channel);
        const leaseKey = this.getLeaseKey(channel, member.userId);

        const existsInHash = await client.hexists(presenceKey, member.userId);
        const isNew = existsInHash === 0;

        const serialized = JSON.stringify(member);
        const pipeline = client.pipeline();
        pipeline.hset(presenceKey, member.userId, serialized);
        pipeline.set(leaseKey, '1', 'EX', ttlSeconds);
        await pipeline.exec();

        return { isNew, member };
      } catch (err) {
        this.logger.warn(`Redis Presence join failed, falling back to memory: ${(err as Error).message}`);
      }
    }

    // 内存模式降级
    let channelMap = this.memoryStore.get(channel);
    if (!channelMap) {
      channelMap = new Map();
      this.memoryStore.set(channel, channelMap);
    }

    const now = Date.now();
    const existing = channelMap.get(member.userId);
    const isNew = !existing || existing.expiresAt <= now;

    channelMap.set(member.userId, {
      member: member as unknown as PresenceMember,
      expiresAt: now + ttlSeconds * 1000,
    });

    return { isNew, member };
  }

  /**
   * 成员离开 Presence 频道
   */
  async leave(channel: string, userId: string): Promise<boolean> {
    const client = this.getRedisClient();

    if (client) {
      try {
        const presenceKey = this.getPresenceKey(channel);
        const leaseKey = this.getLeaseKey(channel, userId);

        const pipeline = client.pipeline();
        pipeline.hdel(presenceKey, userId);
        pipeline.del(leaseKey);
        const results = await pipeline.exec();

        // results[0][1] 为 hdel 影响的字段数
        const deletedCount = (results?.[0]?.[1] as number) ?? 0;
        return deletedCount > 0;
      } catch (err) {
        this.logger.warn(`Redis Presence leave failed, falling back to memory: ${(err as Error).message}`);
      }
    }

    // 内存模式降级
    const channelMap = this.memoryStore.get(channel);
    if (!channelMap) {
      return false;
    }

    const existed = channelMap.delete(userId);
    if (channelMap.size === 0) {
      this.memoryStore.delete(channel);
    }
    return existed;
  }

  /**
   * 刷新在场租期心跳
   */
  async heartbeat(
    channel: string,
    userId: string,
    ttlSeconds: number = DEFAULT_PRESENCE_TTL_SECONDS,
  ): Promise<boolean> {
    const client = this.getRedisClient();

    if (client) {
      try {
        const presenceKey = this.getPresenceKey(channel);
        const leaseKey = this.getLeaseKey(channel, userId);

        const memberJson = await client.hget(presenceKey, userId);
        if (!memberJson) {
          return false;
        }

        // 刷新成员 updatedAt 时间戳并续约租期 Key
        const member = JSON.parse(memberJson) as PresenceMember;
        member.updatedAt = Date.now();

        const pipeline = client.pipeline();
        pipeline.hset(presenceKey, userId, JSON.stringify(member));
        pipeline.set(leaseKey, '1', 'EX', ttlSeconds);
        await pipeline.exec();

        return true;
      } catch (err) {
        this.logger.warn(`Redis Presence heartbeat failed, falling back to memory: ${(err as Error).message}`);
      }
    }

    // 内存模式降级
    const channelMap = this.memoryStore.get(channel);
    const item = channelMap?.get(userId);
    if (!item || item.expiresAt <= Date.now()) {
      return false;
    }

    item.member.updatedAt = Date.now();
    item.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }

  /**
   * 获取指定频道的所有在场有效成员（自动清理租期已过期的幽灵成员）
   */
  async getMembers<T = PresenceMemberInfo>(channel: string): Promise<PresenceMember<T>[]> {
    if (this.configService?.get('BROADCAST_DRIVER') === 'centrifugo' && this.centrifugoTransport) {
      const remoteMembers = await this.centrifugoTransport.getPresence<T>(channel);
      return remoteMembers.map((m) => ({
        userId: m.userId,
        clientId: m.clientId,
        userInfo: m.info,
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      }));
    }

    const client = this.getRedisClient();

    if (client) {
      try {
        const presenceKey = this.getPresenceKey(channel);
        const allMembersRaw = await client.hgetall(presenceKey);

        const userIds = Object.keys(allMembersRaw);
        if (userIds.length === 0) {
          return [];
        }

        // 批量检测对应的租期 Key 是否依然存活
        const pipeline = client.pipeline();
        for (const uid of userIds) {
          pipeline.exists(this.getLeaseKey(channel, uid));
        }
        const existsResults = await pipeline.exec();

        const activeMembers: PresenceMember<T>[] = [];
        const expiredUserIds: string[] = [];

        userIds.forEach((uid, index) => {
          const isAlive = (existsResults?.[index]?.[1] as number) === 1;
          if (isAlive) {
            try {
              activeMembers.push(JSON.parse(allMembersRaw[uid]) as PresenceMember<T>);
            } catch {
              expiredUserIds.push(uid);
            }
          } else {
            expiredUserIds.push(uid);
          }
        });

        // 异步批量剔除幽灵成员
        if (expiredUserIds.length > 0) {
          const cleanupPipeline = client.pipeline();
          for (const expiredId of expiredUserIds) {
            cleanupPipeline.hdel(presenceKey, expiredId);
          }
          cleanupPipeline.exec().catch(() => {});
        }

        return activeMembers;
      } catch (err) {
        this.logger.warn(`Redis Presence getMembers failed, falling back to memory: ${(err as Error).message}`);
      }
    }

    // 内存模式降级
    const channelMap = this.memoryStore.get(channel);
    if (!channelMap) {
      return [];
    }

    const now = Date.now();
    const activeMembers: PresenceMember<T>[] = [];
    const expiredIds: string[] = [];

    for (const [uid, item] of channelMap.entries()) {
      if (item.expiresAt > now) {
        activeMembers.push(item.member as unknown as PresenceMember<T>);
      } else {
        expiredIds.push(uid);
      }
    }

    for (const expiredId of expiredIds) {
      channelMap.delete(expiredId);
    }
    if (channelMap.size === 0) {
      this.memoryStore.delete(channel);
    }

    return activeMembers;
  }

  /**
   * 获取指定频道中的单个在场成员
   */
  async getMember<T = PresenceMemberInfo>(channel: string, userId: string): Promise<PresenceMember<T> | null> {
    const members = await this.getMembers<T>(channel);
    return members.find((m) => m.userId === userId) ?? null;
  }

  /**
   * 清理过期租期成员，并返回被剔除的用户 ID 列表（供事件广播使用）
   */
  async cleanExpired(channel: string): Promise<string[]> {
    const client = this.getRedisClient();

    if (client) {
      try {
        const presenceKey = this.getPresenceKey(channel);
        const allMembersRaw = await client.hgetall(presenceKey);
        const userIds = Object.keys(allMembersRaw);

        if (userIds.length === 0) {
          return [];
        }

        const pipeline = client.pipeline();
        for (const uid of userIds) {
          pipeline.exists(this.getLeaseKey(channel, uid));
        }
        const existsResults = await pipeline.exec();
        const expiredUserIds: string[] = [];

        userIds.forEach((uid, index) => {
          const isAlive = (existsResults?.[index]?.[1] as number) === 1;
          if (!isAlive) {
            expiredUserIds.push(uid);
          }
        });

        if (expiredUserIds.length > 0) {
          const cleanupPipeline = client.pipeline();
          for (const expiredId of expiredUserIds) {
            cleanupPipeline.hdel(presenceKey, expiredId);
          }
          await cleanupPipeline.exec();
        }

        return expiredUserIds;
      } catch (err) {
        this.logger.warn(`Redis Presence cleanExpired failed, falling back to memory: ${(err as Error).message}`);
      }
    }

    // 内存模式降级
    const channelMap = this.memoryStore.get(channel);
    if (!channelMap) {
      return [];
    }

    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [uid, item] of channelMap.entries()) {
      if (item.expiresAt <= now) {
        expiredIds.push(uid);
      }
    }

    for (const expiredId of expiredIds) {
      channelMap.delete(expiredId);
    }
    if (channelMap.size === 0) {
      this.memoryStore.delete(channel);
    }

    return expiredIds;
  }
}
