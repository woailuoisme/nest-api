import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MailError, Mailer } from '@nestjs/mail';
import { type Job, UnrecoverableError } from 'bullmq';

import { MAIL_QUEUE } from '@/common/constants/queues';
import type { MailPayload } from '@/common/mail/mail.types';
import { EmailOtpMail, type EmailOtpData } from '@/common/mail/mails/email-otp.mail';
import { PasswordResetMail, type PasswordResetData } from '@/common/mail/mails/password-reset.mail';
import { VerifyEmailMail, type VerifyEmailData } from '@/common/mail/mails/verify-email.mail';
import { WelcomeMail, type WelcomeData } from '@/common/mail/mails/welcome.mail';
import { QueueProcessorHost } from '@/jobs/queue-processor.host';

import { MailJobName } from './mail.jobs';

/** 判断是否为不可重试的邮件错误（模板缺失、地址非法等） */
function isPermanentMailError(error: unknown): error is MailError {
  return error instanceof MailError && error.permanent;
}

/**
 * 邮件队列消费者 — 按任务名路由到对应 Mailable，由官方 `Mailer` 渲染并投递。
 *
 * 重试由 BullMQ 承担（生产者已设置 attempts + 指数退避）；永久失败（模板缺失、
 * 地址非法）转 `UnrecoverableError` 立即终止重试。
 */
@Processor(MAIL_QUEUE, { concurrency: 5 })
export class MailProcessor extends QueueProcessorHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailer: Mailer) {
    super();
  }

  async process(job: Job<MailPayload<unknown>>): Promise<void> {
    const { to, locale, data } = job.data;

    try {
      switch (job.name) {
        case MailJobName.VerifyEmail:
          await this.mailer.send(VerifyEmailMail, { to, locale, data: data as VerifyEmailData });
          return;
        case MailJobName.PasswordReset:
          await this.mailer.send(PasswordResetMail, { to, locale, data: data as PasswordResetData });
          return;
        case MailJobName.EmailOtp:
          await this.mailer.send(EmailOtpMail, { to, locale, data: data as EmailOtpData });
          return;
        case MailJobName.Welcome:
          await this.mailer.send(WelcomeMail, { to, locale, data: data as WelcomeData });
          return;
        default:
          // 未知任务名视为不可重试错误：静默完成会让漏投递无从察觉
          throw new UnrecoverableError(`Unknown mail job: ${job.name}`);
      }
    } catch (error) {
      this.logger.error(`Mail delivery failed (job=${job.id} name=${job.name}): ${(error as Error).message}`);
      if (isPermanentMailError(error)) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }
}
