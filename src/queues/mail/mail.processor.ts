import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MAIL_QUEUE } from '@/common/constants/queues';
import { MailHandlers } from './mail.handlers';
import { type MailJobData, MailJobName } from './mail.jobs';

/** 邮件队列消费者 — 纯路由：按 job.name 分发到对应 handler，发送逻辑在 MailHandlers */
@Processor(MAIL_QUEUE, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly handlers: MailHandlers) {
    super();
  }

  async process(job: Job<MailJobData>) {
    switch (job.name) {
      case MailJobName.VerifyEmail:
        await this.handlers.handleVerifyEmail(job.data);
        break;
      case MailJobName.ResetPassword:
        await this.handlers.handleResetPassword(job.data);
        break;
      case MailJobName.Welcome:
        await this.handlers.handleWelcome(job.data);
        break;
      default:
        this.logger.warn(`Unknown mail job: ${job.name}`);
    }
  }
}
