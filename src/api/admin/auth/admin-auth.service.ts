import { createHash } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { pick } from 'es-toolkit';
import { AdminStatus } from '@/common/constants/roles';
import { parseDuration } from '@/common/utils/duration.util';
import { Hash } from '@/common/utils/hash.util';
import { uuidv7 } from '@/common/utils/uuid.util';
import type { EnvConfig } from '@/config/env.validation';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { adminRefreshTokens, adminUsers } from '@/database/drizzle/schema';
import type { AdminLoginRequest, AdminProfileResponse, AdminTokenPairResponse } from './admin-auth.dto';

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    @InjectDb() private readonly db: DrizzleDB,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  /**
   * 后台管理员登录
   */
  async login(dto: AdminLoginRequest, ip?: string): Promise<AdminTokenPairResponse> {
    const admin = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.email, dto.email),
    });

    if (!admin?.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await Hash.check(dto.password, admin.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (admin.status !== AdminStatus.ACTIVE) {
      throw new UnauthorizedException('Administrator account is disabled');
    }

    const now = new Date();
    // 异步或同步更新最后登录信息
    await this.db
      .update(adminUsers)
      .set({
        lastLoginAt: now,
        lastLoginIp: ip ?? null,
        updatedAt: now,
      })
      .where(eq(adminUsers.id, admin.id));

    const tokenPair = await this.issueTokenPair(admin);
    this.logger.log(`Administrator ${admin.email} (ID: ${admin.id}) logged in successfully`);

    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        status: admin.status,
        avatarUrl: admin.avatarUrl,
        lastLoginAt: now.toISOString(),
      },
    };
  }

  /**
   * 后台管理员刷新 Token
   */
  async refreshToken(rawRefreshToken: string): Promise<AdminTokenPairResponse> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const now = new Date();

    const [revoked] = await this.db
      .update(adminRefreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(adminRefreshTokens.tokenHash, tokenHash),
          isNull(adminRefreshTokens.revokedAt),
          gt(adminRefreshTokens.expiresAt, now),
        ),
      )
      .returning({ adminUserId: adminRefreshTokens.adminUserId });

    if (!revoked) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    const admin = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, revoked.adminUserId),
    });

    if (!admin) {
      throw new UnauthorizedException('Administrator account not found');
    }

    if (admin.status !== AdminStatus.ACTIVE) {
      throw new UnauthorizedException('Administrator account is disabled');
    }

    const tokenPair = await this.issueTokenPair(admin);
    this.logger.log(`Administrator ${admin.email} (ID: ${admin.id}) refreshed token successfully`);

    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        status: admin.status,
        avatarUrl: admin.avatarUrl,
        lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * 后台管理员注销登录
   */
  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.db
      .update(adminRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(adminRefreshTokens.tokenHash, tokenHash), isNull(adminRefreshTokens.revokedAt)));
    this.logger.log('Administrator logged out and refresh token revoked');
  }

  /**
   * 获取当前管理员个人信息
   */
  async getProfile(adminId: number): Promise<AdminProfileResponse> {
    const admin = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, adminId),
    });

    if (!admin) {
      throw new UnauthorizedException('Administrator not found');
    }

    return {
      ...pick(admin, ['id', 'name', 'email', 'role', 'status', 'avatarUrl']),
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    };
  }

  /**
   * 签发后台管理员专用 Token 对
   */
  private async issueTokenPair(admin: { id: number; email: string; role: string }): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const accessSecret = this.configService.get('JWT_ACCESS_SECRET');
    const accessExpiresIn = this.configService.get('JWT_ACCESS_EXPIRES_IN');
    const refreshSecret = this.configService.get('JWT_REFRESH_SECRET');
    const refreshExpiresIn = this.configService.get('JWT_REFRESH_EXPIRES_IN');

    const payload = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      guard: 'admin',
    };

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

    await this.db.insert(adminRefreshTokens).values({
      adminUserId: admin.id,
      tokenHash,
      expiresAt,
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
