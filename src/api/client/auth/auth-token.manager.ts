import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { and, eq, gt, inArray, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm';
import type { Role } from '@/common/constants/roles';
import { parseDuration } from '@/common/utils/duration.util';
import { Otp } from '@/common/utils/otp.util';
import { uuidv7 } from '@/common/utils/uuid.util';
import type { EnvConfig } from '@/config/env.validation';
import { type DrizzleDB, type DrizzleTx, InjectDb } from '@/database/drizzle/drizzle.service';
import { ephemeralTokens, refreshTokens, users } from '@/database/drizzle/schema';
import type { TokenPairResponse } from './auth.dto';

export type EphemeralTokenType = 'password_reset' | 'email_verification';

export interface IssuedEphemeralToken {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

const EPHEMERAL_TOKEN_ERRORS: Record<EphemeralTokenType, string> = {
  password_reset: 'Invalid or expired reset token',
  email_verification: 'Invalid or expired verification code',
};

/**
 * 统一认证令牌全生命周期管理器 (AuthTokenManager)
 *
 * 聚合收敛所有 Token 相关的生成、签名、持久化、原子轮换与单条 SQL 消费：
 * 1. JWT Access + Refresh Token 签发与入库
 * 2. Refresh Token 单条原子 SQL 吊销与轮换
 * 3. 临时令牌（密码重置 / 6位 OTP 邮箱验证）CSPRNG 签发与单条原子 SQL 核销
 * 4. 过期与废弃 Token 批量清理（Subquery LIMIT 分批，避免大事务锁表）
 */
export interface AuthUserContext {
  id: number;
  email: string;
  role: Role;
}

@Injectable()
export class AuthTokenManager {
  private readonly logger = new Logger(AuthTokenManager.name);

  constructor(
    @InjectDb() private readonly db: DrizzleDB,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  /**
   * 签发 Access + Refresh Token 令牌对，并将 Refresh Token 哈希入库。
   */
  async issueTokenPair(user: AuthUserContext): Promise<TokenPairResponse> {
    const { id: userId, email, role } = user;

    const accessSecret = this.configService.get('JWT_ACCESS_SECRET');
    const accessExpiresIn = this.configService.get('JWT_ACCESS_EXPIRES_IN');
    const refreshSecret = this.configService.get('JWT_REFRESH_SECRET');
    const refreshExpiresIn = this.configService.get('JWT_REFRESH_EXPIRES_IN');

    const payload = { sub: userId, email, role, guard: 'user' };

    const accessToken = this.jwtService.sign(payload, {
      secret: accessSecret,
      expiresIn: accessExpiresIn as NonNullable<JwtSignOptions['expiresIn']>,
    });
    const refreshToken = this.jwtService.sign(
      { ...payload, jti: uuidv7() },
      {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn as NonNullable<JwtSignOptions['expiresIn']>,
      },
    );

    const refreshTtlMs = parseDuration(refreshExpiresIn);
    const expiresAt = new Date(Date.now() + refreshTtlMs);
    const tokenHash = this.hashToken(refreshToken);

    await this.db.insert(refreshTokens).values({
      userId,
      tokenHash,
      expiresAt,
    });

    return { accessToken, refreshToken };
  }

  /**
   * 单条 SQL 原子轮换 Refresh Token：
   * 1. 原子标记当前有效 Refresh Token 为已吊销并 RETURNING userId
   * 2. 查询用户最新状态并重新签发 TokenPair
   * 若 Token 不存在、已过期或已被吊销，抛出 UnauthorizedException。
   */
  async rotateRefreshToken(rawRefreshToken: string): Promise<TokenPairResponse> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const now = new Date();

    const [revoked] = await this.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, now)),
      )
      .returning({ userId: refreshTokens.userId });

    if (!revoked) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    const user = await this.db.query.users.findFirst({
      where: eq(users.id, revoked.userId),
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.issueTokenPair(user);
  }

  /**
   * 吊销指定的 Refresh Token（注销登录）
   */
  async revokeRefreshToken(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
  }

  /**
   * 撤销某用户的所有有效 refresh token（密码重置等安全场景调用）
   * 支持传入事务执行器 tx 以在事务内原子执行。
   */
  async revokeAllForUser(userId: number, tx: DrizzleDB | DrizzleTx = this.db): Promise<void> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  /**
   * 签发临时业务令牌（重置密码 / 6位 OTP 邮箱验证）
   * 邮箱验证默认生成 6 位加密安全数字 OTP 码（如 "384729"），密码重置生成 64 位十六进制 Token
   * 内部处理 SHA-256 哈希与入库。
   */
  async issueEphemeralToken(
    type: EphemeralTokenType,
    userId: number,
    ttlHours: number,
    options?: { isOtp?: boolean },
  ): Promise<IssuedEphemeralToken> {
    const isOtp = options?.isOtp ?? type === 'email_verification';
    const rawToken = isOtp ? Otp.generate() : randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + ttlHours);

    await this.db.insert(ephemeralTokens).values({
      type,
      tokenHash,
      userId,
      expiresAt,
    });

    return { rawToken, tokenHash, expiresAt };
  }

  /**
   * 单条原子 SQL 校验并消费临时令牌。
   * 单次往返完成「校验类型匹配、未过期且未被消费」+「标记已使用」，彻底防御 TOCTOU 并发重放。
   * 支持传入事务执行器 tx 以在事务内原子执行。
   * 若令牌无效、过期或已被消费，直接抛出 UnauthorizedException。
   */
  async consumeEphemeralToken(
    type: EphemeralTokenType,
    rawToken: string,
    tx: DrizzleDB | DrizzleTx = this.db,
  ): Promise<{ userId: number }> {
    const tokenHash = this.hashToken(rawToken);
    const now = new Date();
    const errorMessage = EPHEMERAL_TOKEN_ERRORS[type];

    const [consumed] = await tx
      .update(ephemeralTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(ephemeralTokens.tokenHash, tokenHash),
          eq(ephemeralTokens.type, type),
          isNull(ephemeralTokens.usedAt),
          gt(ephemeralTokens.expiresAt, now),
        ),
      )
      .returning({ userId: ephemeralTokens.userId });

    if (!consumed) {
      throw new UnauthorizedException(errorMessage);
    }
    return { userId: consumed.userId };
  }

  /**
   * 对原始令牌计算 SHA-256 哈希
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * 定时清理过期或已废弃的令牌。
   * 使用子查询 LIMIT 分批循环删除，避免长事务表级锁。
   */
  async purgeExpiredTokens(batchSize = 1000): Promise<number> {
    const now = new Date();
    let totalDeleted = 0;

    const purgeTableBatch = async (
      table: typeof refreshTokens | typeof ephemeralTokens,
      whereCondition: SQL | undefined,
      label: string,
    ): Promise<number> => {
      let tableTotal = 0;
      let deleted = 0;

      do {
        const expiredIds = this.db.select({ id: table.id }).from(table).where(whereCondition).limit(batchSize);

        const result = await this.db
          .delete(table)
          .where(inArray(table.id, expiredIds))
          .returning({ deletedId: table.id });

        deleted = result.length;
        tableTotal += deleted;
      } while (deleted >= batchSize);

      if (tableTotal > 0) {
        this.logger.log(`Purged ${tableTotal} expired ${label}`);
      }
      return tableTotal;
    };

    totalDeleted += await purgeTableBatch(
      refreshTokens,
      or(lt(refreshTokens.expiresAt, now), isNotNull(refreshTokens.revokedAt)),
      'refresh_tokens',
    );

    totalDeleted += await purgeTableBatch(
      ephemeralTokens,
      or(lt(ephemeralTokens.expiresAt, now), isNotNull(ephemeralTokens.usedAt)),
      'ephemeral_tokens',
    );

    return totalDeleted;
  }
}
