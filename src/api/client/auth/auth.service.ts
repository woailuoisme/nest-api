import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { delay } from 'es-toolkit';
import { I18N } from '@/common/constants/app.constants';
import { Hash } from '@/common/utils/hash.util';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { oauthAccounts, users } from '@/database/drizzle/schema';
import { MailJobs, type MailLocale } from '@/queues/mail/mail.jobs';
import type { LoginRequest, RegisterRequest, TokenPairResponse } from './auth.dto';
import { AuthTokenManager } from './auth-token.manager';
import type { OAuthProfile } from './strategies/oauth-profile.interface';

/**
 * 认证领域业务服务
 *
 * 专注于用户注册、凭据校验、OAuth 登录绑定与密码/邮箱重置等领域编排，
 * 令牌的生成、哈希、存储与单条 SQL 原子核销完全委托给 AuthTokenManager。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectDb() private readonly db: DrizzleDB,
    private readonly mailQueue: MailJobs,
    private readonly authTokenManager: AuthTokenManager,
  ) {}

  async register(dto: RegisterRequest): Promise<TokenPairResponse> {
    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, dto.email),
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await Hash.make(dto.password);
    const [user] = await this.db.insert(users).values({ name: dto.name, email: dto.email, passwordHash }).returning();

    const locale = dto.locale ?? I18N.FALLBACK_LANG;
    const { rawToken } = await this.authTokenManager.issueEphemeralToken('email_verification', user.id, 24);
    await this.mailQueue.queueVerificationEmail(user.email, user.name, rawToken, locale);

    return this.authTokenManager.issueTokenPair(user);
  }

  async login(dto: LoginRequest): Promise<TokenPairResponse> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.email, dto.email),
    });

    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!(await Hash.check(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.authTokenManager.issueTokenPair(user);
  }

  async validateOAuthLogin(profile: OAuthProfile): Promise<TokenPairResponse> {
    const linkedAccount = await this.db.query.oauthAccounts.findFirst({
      where: and(
        eq(oauthAccounts.provider, profile.provider),
        eq(oauthAccounts.providerUserId, profile.providerUserId),
      ),
      with: { user: true },
    });

    if (linkedAccount) {
      return this.authTokenManager.issueTokenPair(linkedAccount.user);
    }

    // 归一化：OAuth provider 返回的 email 可能带大小写，统一 lowercase
    const email = profile.email.toLowerCase().trim();
    const existingUser = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });

    // 新用户流程：使用事务原子创建用户与 OAuth 关联记录
    if (!existingUser) {
      const newUser = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            name: profile.name,
            email,
            emailVerifiedAt: new Date(),
          })
          .returning();

        await tx.insert(oauthAccounts).values({
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          userId: created.id,
        });

        return created;
      });

      return this.authTokenManager.issueTokenPair(newUser);
    }

    // 账户接管防护：邮箱已存在但未完成验证时，禁止通过 OAuth 自动绑定
    if (!existingUser.emailVerifiedAt) {
      throw new ConflictException('Email already registered but not verified. Please verify your email first.');
    }

    await this.db
      .insert(oauthAccounts)
      .values({
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        userId: existingUser.id,
      })
      .returning()
      .catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && (error as { code: string }).code === '23505') {
          this.logger.warn(
            `OAuth duplicate binding attempt: provider=${profile.provider}, providerUserId=${profile.providerUserId}`,
          );
          throw new ConflictException('This OAuth provider is already linked to an account');
        }
        throw error;
      });

    return this.authTokenManager.issueTokenPair(existingUser);
  }

  async forgotPassword(email: string, locale: MailLocale = I18N.FALLBACK_LANG): Promise<void> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (user) {
      const { rawToken } = await this.authTokenManager.issueEphemeralToken('password_reset', user.id, 1);
      await this.mailQueue.queuePasswordResetEmail(user.email, user.name, rawToken, locale);
    }

    // 恒定时间侧信道防御：无论用户是否存在均执行等长延迟后返回通用响应
    await delay(200);
  }

  /**
   * 刷新 Token 令牌对
   */
  async refreshToken(rawRefreshToken: string): Promise<TokenPairResponse> {
    return this.authTokenManager.rotateRefreshToken(rawRefreshToken);
  }

  /**
   * 注销登录（吊销指定的 Refresh Token）
   */
  async logout(rawRefreshToken: string): Promise<void> {
    await this.authTokenManager.revokeRefreshToken(rawRefreshToken);
  }

  /**
   * 重置密码 — 事务原子核销 Token、更新密码并吊销所有 Refresh Token，消除并发重放窗口
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const passwordHash = await Hash.make(newPassword);

    await this.db.transaction(async (tx) => {
      const { userId } = await this.authTokenManager.consumeEphemeralToken('password_reset', rawToken, tx);
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
      await this.authTokenManager.revokeAllForUser(userId, tx);
    });
  }

  /**
   * 验证邮箱 — 事务原子核销 Token 并更新邮箱已验证状态，消除并发重放窗口
   */
  async verifyEmail(rawToken: string): Promise<void> {
    const userId = await this.db.transaction(async (tx) => {
      const { userId } = await this.authTokenManager.consumeEphemeralToken('email_verification', rawToken, tx);
      await tx.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
      return userId;
    });

    // 邮箱验证通过后补发欢迎邮件
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (user) {
      await this.mailQueue.queueWelcomeEmail(user.email, user.name, I18N.FALLBACK_LANG);
    }
  }
}
