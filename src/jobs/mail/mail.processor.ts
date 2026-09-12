import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MAIL_QUEUE } from '@/common/constants/queues';
import { MailService } from '@/common/mail';
import { type MailJobData, MailJobName } from './mail.jobs';

/** 邮件队列消费者 — 纯路由：按 job.name 分发至全局 MailService 领域发信门面 */
@Processor(MAIL_QUEUE, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<MailJobData>) {
    switch (job.name) {
      case MailJobName.VerifyEmail:
        await this.mailService.sendVerificationEmail(job.data);
        break;
      case MailJobName.ResetPassword:
        await this.mailService.sendPasswordResetEmail(job.data);
        break;
      case MailJobName.Welcome:
        await this.mailService.sendWelcomeEmail(job.data);
        break;
      default:
        this.logger.warn(`Unknown mail job: ${job.name}`);
    }
  }
}
