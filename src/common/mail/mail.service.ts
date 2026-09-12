import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ISendMailOptions, MailerService } from '@nestjs-modules/mailer';
import type { EnvConfig } from '@/config/env.validation';
import { type MailJobData, MailJobName, type MailLocale } from '@/jobs/mail/mail.jobs';

/** 邮件主题文案字典（与模板语言严格对齐） */
export const MAIL_SUBJECTS: Record<MailJobName, Record<MailLocale, string>> = {
  [MailJobName.VerifyEmail]: { zh: '验证您的邮箱', en: 'Verify your email' },
  [MailJobName.ResetPassword]: { zh: '重置密码', en: 'Reset your password' },
  [MailJobName.Welcome]: { zh: '欢迎加入 NestForge', en: 'Welcome to NestForge' },
};

/**
 * 全局邮件领域服务 (MailService 门面)
 *
 * 统一提供强类型发信接口，统筹主题文案、业务跳转链接拼装与模板渲染上下文。
 * 底层基于 @nestjs-modules/mailer + HandlebarsAdapter，兼顾异步队列消费与业务同步直发需求。
 */
@Injectable()
export class MailService {
  private readonly appUrl: string;

  constructor(
    private readonly mailerService: MailerService,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.appUrl = config.get('APP_URL');
  }

  /**
   * 发送邮箱验证邮件
   */
  async sendVerificationEmail({ to, name, token, locale }: MailJobData): Promise<void> {
    const link = `${this.appUrl}/auth/verify-email?token=${token}`;
    await this.mailerService.sendMail({
      to,
      subject: MAIL_SUBJECTS[MailJobName.VerifyEmail][locale],
      template: `verify-email.${locale}.hbs`,
      context: { name, link },
    });
  }

  /**
   * 发送密码重置邮件
   */
  async sendPasswordResetEmail({ to, name, token, locale }: MailJobData): Promise<void> {
    const link = `${this.appUrl}/auth/reset-password?token=${token}`;
    await this.mailerService.sendMail({
      to,
      subject: MAIL_SUBJECTS[MailJobName.ResetPassword][locale],
      template: `reset-password.${locale}.hbs`,
      context: { name, link },
    });
  }

  /**
   * 发送欢迎邮件（注册后，无 token）
   */
  async sendWelcomeEmail({ to, name, locale }: MailJobData): Promise<void> {
    const link = `${this.appUrl}/login`;
    await this.mailerService.sendMail({
      to,
      subject: MAIL_SUBJECTS[MailJobName.Welcome][locale],
      template: `welcome.${locale}.hbs`,
      context: { name, link },
    });
  }

  /**
   * 透传底层原始发信接口（供业务自定义扩展或特殊发信诉求使用）
   */
  sendMail(options: ISendMailOptions) {
    return this.mailerService.sendMail(options);
  }
}
