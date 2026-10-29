import {
  AuthenticationRegistry,
  PasswordResetHandler,
  type PasswordResetAccount,
  type PasswordResetLink,
} from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';

import { MailJobs } from '@/jobs/mail/mail.jobs';

import { UsersRepository } from '../users.repository';

/** 将找回密码链接投递到邮件队列，并落库新的密码哈希 */
@Injectable()
export class PasswordResetMailer extends PasswordResetHandler {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly mailJobs: MailJobs,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerHandler('passwordReset', this);
  }

  async findUser(email: string): Promise<PasswordResetAccount | null> {
    const found = await this.usersRepository.findCredentials(email);
    return found ? { id: found.user.id, email: found.user.email, passwordHash: found.passwordHash } : null;
  }

  async send(link: PasswordResetLink): Promise<void> {
    const user = await this.usersRepository.findById(link.userId);
    const token = new URL(link.url).searchParams.get('token') ?? '';
    await this.mailJobs.queuePasswordResetEmail(link.email, user?.name ?? link.email, token, 'zh', link.url);
  }

  updatePassword(userId: string, passwordHash: string): Promise<void> {
    return this.usersRepository.updatePasswordHash(userId, passwordHash);
  }
}
