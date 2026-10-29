import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { MAIL_QUEUE } from '@/common/constants/queues';
import type { MailLocale, MailPayload, MailTemplateName } from '@/common/mail/mail.types';
import type { EmailOtpData } from '@/common/mail/mails/email-otp.mail';
import type { PasswordResetData } from '@/common/mail/mails/password-reset.mail';
import type { VerifyEmailData } from '@/common/mail/mails/verify-email.mail';
import type { WelcomeData } from '@/common/mail/mails/welcome.mail';

/** 邮件任务名（与模板名同源，`satisfies` 保证编译期不会漂移） */
export const MailJobName = {
  VerifyEmail: 'verify-email',
  PasswordReset: 'reset-password',
  EmailOtp: 'email-otp',
  Welcome: 'welcome',
} as const satisfies Record<string, MailTemplateName>;

export type MailJobName = (typeof MailJobName)[keyof typeof MailJobName];

/** 单封邮件最多重试次数（指数退避，最终由 `removeOnFail` 保留窗口收敛） */
const MAIL_JOB_ATTEMPTS = 5;
const MAIL_JOB_BACKOFF_MS = 10_000;

/**
 * 邮件生产者门面 — 投递到 BullMQ `mail` 队列，由 Worker 进程消费并调用官方 `Mailer`。
 *
 * 重试语义由队列承担（`attempts` + 指数退避），API 进程不阻塞在 SMTP 往返上。
 */
@Injectable()
export class MailJobs {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue) {}

  queueVerificationEmail(to: string, name: string, token: string, locale: MailLocale, url?: string) {
    return this.enqueue<VerifyEmailData>(MailJobName.VerifyEmail, {
      to: { name, address: to },
      locale,
      data: { name, token, url },
    });
  }

  queuePasswordResetEmail(to: string, name: string, token: string, locale: MailLocale, url?: string) {
    return this.enqueue<PasswordResetData>(MailJobName.PasswordReset, {
      to: { name, address: to },
      locale,
      data: { name, token, url },
    });
  }

  queueEmailOtp(to: string, name: string, code: string, locale: MailLocale) {
    return this.enqueue<EmailOtpData>(MailJobName.EmailOtp, {
      to: { name, address: to },
      locale,
      data: { name, code },
    });
  }

  queueWelcomeEmail(to: string, name: string, locale: MailLocale) {
    return this.enqueue<WelcomeData>(MailJobName.Welcome, {
      to: { name, address: to },
      locale,
      data: { name },
    });
  }

  private enqueue<T>(name: MailJobName, payload: MailPayload<T>) {
    return this.queue.add(name, payload, {
      attempts: MAIL_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: MAIL_JOB_BACKOFF_MS },
    });
  }
}
