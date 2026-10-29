import { EmailVerificationService, SignInService, type SessionRecord } from '@nestjs/authentication';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

import { CredentialsService } from './credentials.service';

/** 登录 / 注册编排：基于官方 `SignInService` / `EmailVerificationService` */
@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);

  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly signInService: SignInService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  async signUpWithPassword(email: string, password: string): Promise<CurrentUserPayload> {
    const user = await this.credentialsService.register(email, password);
    await this.signInService.signIn(user.id, { method: 'password' });
    await this.sendVerificationEmail(user);
    return user;
  }

  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<{ user: CurrentUserPayload; session: SessionRecord }> {
    const user = await this.credentialsService.verify(email, password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const { session } = await this.signInService.signIn(user.id, { method: 'password' });
    return { user, session };
  }

  async signInUser(userId: string, method: string): Promise<{ session: SessionRecord }> {
    const { session } = await this.signInService.signIn(userId, { method });
    return { session };
  }

  /** 验证邮件是弱依赖：入队失败只记 warn，不阻断注册 */
  private async sendVerificationEmail(user: CurrentUserPayload): Promise<void> {
    try {
      await this.emailVerificationService.send(user);
    } catch (error) {
      this.logger.warn(`Verification email could not be queued for ${user.id}: ${(error as Error).message}`);
    }
  }
}
