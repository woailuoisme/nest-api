import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthTokenManager } from '@/api/client/auth/auth-token.manager';
import { Role } from '@/common/constants/roles';
import type { DrizzleDB } from '@/database/drizzle/drizzle.service';
import { ephemeralTokens } from '@/database/drizzle/schema';

describe('AuthTokenManager', () => {
  let manager: AuthTokenManager;
  let jwtService: { sign: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };
  let db: any;
  let insertValuesMock: ReturnType<typeof vi.fn>;
  let updateReturningMock: ReturnType<typeof vi.fn>;
  let updateWhereMock: ReturnType<typeof vi.fn>;
  let updateSetMock: ReturnType<typeof vi.fn>;
  let findFirstMock: ReturnType<typeof vi.fn>;
  let deleteReturningMock: ReturnType<typeof vi.fn>;
  let selectLimitMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jwtService = {
      sign: vi.fn((payload) => `signed-${payload.sub}-${payload.role}`),
    };

    configService = {
      get: vi.fn((key: string) => {
        const configMap: Record<string, string> = {
          JWT_ACCESS_SECRET: 'access-secret',
          JWT_ACCESS_EXPIRES_IN: '15m',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_REFRESH_EXPIRES_IN: '7d',
        };
        return configMap[key];
      }),
    };

    insertValuesMock = vi.fn().mockResolvedValue([{ id: 1 }]);
    updateReturningMock = vi.fn().mockResolvedValue([{ userId: 1 }]);
    updateWhereMock = vi.fn(() => ({
      returning: updateReturningMock,
    }));
    updateSetMock = vi.fn(() => ({
      where: updateWhereMock,
    }));

    findFirstMock = vi.fn().mockResolvedValue({ id: 1, email: 'user@example.com', role: 'USER' });

    deleteReturningMock = vi.fn().mockResolvedValue([]);
    selectLimitMock = vi.fn(() => 'subquery');

    db = {
      insert: vi.fn(() => ({ values: insertValuesMock })),
      update: vi.fn(() => ({ set: updateSetMock })),
      delete: vi.fn(() => ({ where: vi.fn(() => ({ returning: deleteReturningMock })) })),
      select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: selectLimitMock }) }) })),
      query: {
        users: {
          findFirst: findFirstMock,
        },
      },
    };

    manager = new AuthTokenManager(
      db as DrizzleDB,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService<any, true>,
    );
  });

  describe('issueTokenPair()', () => {
    it('应成功签发 Access + Refresh Token 并持久化 Refresh Token', async () => {
      const result = await manager.issueTokenPair({ id: 1, email: 'user@example.com', role: Role.USER });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(jwtService.sign).toHaveBeenCalledTimes(2);
      expect(db.insert).toHaveBeenCalled();
      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
    });
  });

  describe('rotateRefreshToken()', () => {
    it('有效 Refresh Token 应原子更新 revokedAt 并签发新 TokenPair', async () => {
      const result = await manager.rotateRefreshToken('valid-raw-refresh-token');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(db.update).toHaveBeenCalled();
      expect(findFirstMock).toHaveBeenCalled();
    });

    it('无效/过期/已被吊销的 Refresh Token 应抛出 UnauthorizedException', async () => {
      updateReturningMock.mockResolvedValue([]);

      await expect(manager.rotateRefreshToken('invalid-or-revoked-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('Token 存在但关联用户被删除时应抛出 UnauthorizedException', async () => {
      updateReturningMock.mockResolvedValue([{ userId: 999 }]);
      findFirstMock.mockResolvedValue(null);

      await expect(manager.rotateRefreshToken('valid-token-deleted-user')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('revokeRefreshToken()', () => {
    it('应根据 raw token 计算哈希并标记 revokedAt', async () => {
      await manager.revokeRefreshToken('raw-refresh-token');

      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('revokeAllForUser()', () => {
    it('应将指定用户的所有未吊销 token 标记为已吊销', async () => {
      await manager.revokeAllForUser(1);

      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('issueEphemeralToken()', () => {
    it('应为 email_verification 默认生成 6 位数字 OTP 并入库', async () => {
      const result = await manager.issueEphemeralToken('email_verification', 1, 24);

      expect(result.rawToken).toMatch(/^\d{6}$/);
      expect(result.tokenHash).toHaveLength(64);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(db.insert).toHaveBeenCalled();
      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'email_verification',
          userId: 1,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
    });

    it('应为 password_reset 生成 64 位十六进制 token 并入库', async () => {
      const result = await manager.issueEphemeralToken('password_reset', 1, 1);

      expect(result.rawToken).toHaveLength(64);
      expect(result.tokenHash).toHaveLength(64);
      expect(db.insert).toHaveBeenCalled();
      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'password_reset',
          userId: 1,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
    });
  });

  describe('consumeEphemeralToken()', () => {
    it('单条原子 SQL 校验并核销有效令牌，返回关联 userId', async () => {
      updateReturningMock.mockResolvedValue([{ userId: 42 }]);

      const result = await manager.consumeEphemeralToken('password_reset', 'raw-token-123');

      expect(result).toEqual({ userId: 42 });
      expect(db.update).toHaveBeenCalledWith(ephemeralTokens);
      expect(updateWhereMock).toHaveBeenCalledTimes(1);
      expect(updateWhereMock.mock.calls[0][0]).toBeDefined();
    });

    it('令牌不存在/已过期/已被消费时原子 UPDATE 匹配 0 行并抛出 UnauthorizedException', async () => {
      updateReturningMock.mockResolvedValue([]);

      await expect(manager.consumeEphemeralToken('password_reset', 'invalid-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('邮箱验证码消费失败时抛出对应的错误消息', async () => {
      updateReturningMock.mockResolvedValue([]);

      await expect(manager.consumeEphemeralToken('email_verification', 'wrong-code')).rejects.toThrow(
        'Invalid or expired verification code',
      );
    });

    it('支持在外部事务 tx 中执行消费', async () => {
      const mockTx = {
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ userId: 99 }]),
            })),
          })),
        })),
      };

      const result = await manager.consumeEphemeralToken('password_reset', 'raw-token-tx', mockTx as any);

      expect(result).toEqual({ userId: 99 });
      expect(mockTx.update).toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('purgeExpiredTokens()', () => {
    it('应通过子查询 LIMIT 分批循环清理 2 张令牌表', async () => {
      // 模拟每次 batch 删除返回小于 batchSize 的数组以终止循环
      deleteReturningMock.mockResolvedValue([{ deletedId: 1 }]);

      const total = await manager.purgeExpiredTokens(500);

      expect(total).toBe(2);
      expect(db.delete).toHaveBeenCalledTimes(2);
    });
  });
});
