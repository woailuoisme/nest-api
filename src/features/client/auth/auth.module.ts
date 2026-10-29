import '@/common/auth/authentication.types';
import { Module } from '@nestjs/common';

import { ApiKeyRevocationListener } from '@/common/auth/api-key-revocation.listener';
import { ApiKeysRepository } from '@/common/auth/api-keys.repository';
import { ApiKeysService } from '@/common/auth/api-keys.service';
import { AuthSessionService } from '@/common/auth/auth-session.service';
import { DrizzleAuthenticationStore } from '@/common/auth/authentication.store';
import { CredentialsService } from '@/common/auth/credentials.service';
import { EmailVerificationMailer } from '@/common/auth/mailers/email-verification.mailer';
import { PasswordResetMailer } from '@/common/auth/mailers/password-reset.mailer';
import { OtpService } from '@/common/auth/otp.service';
import { ApiKeyAuthProvider } from '@/common/auth/providers/api-key-auth.provider';
import { JwtAuthProvider } from '@/common/auth/providers/jwt-auth.provider';
import { SessionAuthProvider } from '@/common/auth/providers/session-auth.provider';
import { UsersRepository } from '@/common/auth/users.repository';
import { JobsModule } from '@/jobs/jobs.module';

import { ApiKeysController } from './api-keys.controller';
import { AuthController } from './auth.controller';
import { EmailVerificationController } from './email-verification.controller';
import { MfaController } from './mfa.controller';
import { OtpController } from './otp.controller';
import { PasswordResetController } from './password-reset.controller';
import { SessionsController } from './sessions.controller';
import { TokensController } from './tokens.controller';

/**
 * 认证模块 — 全部能力基于官方 `@nestjs/authentication`：
 *
 * - 凭证链：`SessionAuthProvider`(0) → `JwtAuthProvider`(1) → `ApiKeyAuthProvider`(2)
 * - 状态存储：`DrizzleAuthenticationStore` 实现 Session/RefreshToken/Mfa/EmailToken 四个契约
 * - 邮件：`EmailVerificationMailer` / `PasswordResetMailer` 投递到 BullMQ `mail` 队列
 * - 端点：注册登录、令牌、MFA、会话、邮箱验证、密码重置、API Key 管理
 */
@Module({
  imports: [JobsModule],
  controllers: [
    AuthController,
    TokensController,
    MfaController,
    SessionsController,
    EmailVerificationController,
    PasswordResetController,
    OtpController,
    ApiKeysController,
  ],
  providers: [
    UsersRepository,
    CredentialsService,
    AuthSessionService,
    OtpService,
    DrizzleAuthenticationStore,
    ApiKeysRepository,
    ApiKeyAuthProvider,
    ApiKeyRevocationListener,
    ApiKeysService,
    SessionAuthProvider,
    JwtAuthProvider,
    EmailVerificationMailer,
    PasswordResetMailer,
  ],
  exports: [UsersRepository],
})
export class AuthModule {}
