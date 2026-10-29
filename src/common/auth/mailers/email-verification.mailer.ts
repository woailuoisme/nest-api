import { AuthenticationRegistry, EmailVerificationHandler, type EmailVerificationLink } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';

import { MailJobs } from '@/jobs/mail/mail.jobs';

import { UsersRepository } from '../users.repository';

/** 将验证链接投递到邮件队列，并在链接被使用时回写 user.email_verified */
@Injectable()
export class EmailVerificationMailer extends EmailVerificationHandler {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly mailJobs: MailJobs,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerHandler('emailVerification', this);
  }

  async send(link: EmailVerificationLink): Promise<void> {
    const user = await this.usersRepository.findById(link.userId);
    const token = new URL(link.url).searchParams.get('token') ?? '';
    await this.mailJobs.queueVerificationEmail(link.email, user?.name ?? link.email, token, 'zh', link.url);
  }

  markVerified(userId: string, email: string): Promise<boolean> {
    return this.usersRepository.markEmailVerified(userId, email);
  }
}
