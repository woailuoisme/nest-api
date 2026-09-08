import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { MAIL_QUEUE } from '@/common/constants/queues';

/**
 * 邮件队列契约 — 类型 + 生产者（MailJobs）二合一，生产/消费两侧共用。
 * 队列名常量统一见 src/common/constants/queues.ts。
 *
 * 生产者（业务模块，如 AuthModule）— 注入并投递任务：
 *   @Inject() private readonly mailJobs: MailJobs;
 *   await this.mailJobs.queueVerificationEmail('a@b.com', 'Tom', 'token123', 'zh');
 *
 * 消费者（Worker 进程，WorkerModule）— 由 processor 路由 + handlers 执行：
 *   // mail.processor.ts: @Processor(MAIL_QUEUE) 按 job.name 分发
 *   // mail.handlers.ts:  handleVerifyEmail / handleResetPassword 实际发信
 *
 * 新增邮件类型：在此加 MailJobName 枚举 → handlers 加处理方法 → processor 加 case。
 */

/** 邮件任务名称 */
export enum MailJobName {
  VerifyEmail = 'verify-email',
  ResetPassword = 'reset-password',
  Welcome = 'welcome',
}

/** 邮件语言 */
export type MailLocale = 'zh' | 'en';

/** 邮件模板名（对应 templates/*.hbs） */
export type MailTemplateName = 'verify-email' | 'reset-password' | 'welcome';

/** 邮件任务数据载荷（welcome 无 token） */
export interface MailJobData {
  to: string;
  name: string;
  token?: string;
  locale: MailLocale;
}

/** 邮件队列生产者 — 向 BullMQ 投递邮件发送任务（对应 Laravel Job::dispatch） */
@Injectable()
export class MailJobs {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue) {}

  /** 投递邮箱验证邮件 */
  queueVerificationEmail(to: string, name: string, token: string, locale: MailLocale) {
    return this.queue.add(MailJobName.VerifyEmail, { to, name, token, locale });
  }

  /** 投递密码重置邮件 */
  queuePasswordResetEmail(to: string, name: string, token: string, locale: MailLocale) {
    return this.queue.add(MailJobName.ResetPassword, { to, name, token, locale });
  }

  /** 投递欢迎邮件（注册后，无 token） */
  queueWelcomeEmail(to: string, name: string, locale: MailLocale) {
    return this.queue.add(MailJobName.Welcome, { to, name, locale });
  }
}
