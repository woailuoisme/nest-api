import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SendMailOptions, SentMessageInfo, Transporter } from 'nodemailer';
import type { EnvConfig } from '@/config/env.validation';
import { type MailJobData, MailJobName, type MailLocale } from '@/jobs/mail/mail.jobs';
import { MailTemplateRenderer } from './mail-template.renderer';
import { MAIL_TRANSPORTER } from './mail-transporter.provider';

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
 * 底层直接使用 nodemailer 传输层与自持 Handlebars 渲染器，兼顾异步队列消费与业务同步直发需求。
 */
@Injectable()
export class MailService {
  private readonly appUrl: string;

  constructor(
    @Inject(MAIL_TRANSPORTER) private readonly transporter: Transporter,
    private readonly renderer: MailTemplateRenderer,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.appUrl = config.get('APP_URL');
  }

  /**
   * 发送邮箱验证邮件
   */
  async sendVerificationEmail({ to, name, token, locale }: MailJobData): Promise<void> {
    await this.sendTemplateMail({
      to,
      name,
      locale,
      jobName: MailJobName.VerifyEmail,
      link: `${this.appUrl}/auth/verify-email?token=${token}`,
    });
  }

  /**
   * 发送密码重置邮件
   */
  async sendPasswordResetEmail({ to, name, token, locale }: MailJobData): Promise<void> {
    await this.sendTemplateMail({
      to,
      name,
      locale,
      jobName: MailJobName.ResetPassword,
      link: `${this.appUrl}/auth/reset-password?token=${token}`,
    });
  }

  /**
   * 发送欢迎邮件（注册后，无 token）
   */
  async sendWelcomeEmail({ to, name, locale }: MailJobData): Promise<void> {
    await this.sendTemplateMail({
      to,
      name,
      locale,
      jobName: MailJobName.Welcome,
      link: `${this.appUrl}/login`,
    });
  }

  /**
   * 透传底层原始发信接口（供业务自定义扩展或特殊发信诉求使用）
   */
  sendMail(options: SendMailOptions): Promise<SentMessageInfo> {
    return this.transporter.sendMail(options);
  }

  /**
   * 统一模板发信：主题与模板名均由 MailJobName + locale 推导（MailJobName 枚举值即模板基名）
   *
   * 渲染失败（如模板缺失、strict 模式下缺少变量）直接抛错，由队列重试策略承接，不静默降级为空正文。
   */
  private async sendTemplateMail(params: {
    to: string;
    name: string;
    locale: MailLocale;
    jobName: MailJobName;
    link: string;
  }): Promise<void> {
    const html = await this.renderer.render(`${params.jobName}.${params.locale}.hbs`, {
      name: params.name,
      link: params.link,
    });

    await this.transporter.sendMail({
      to: params.to,
      subject: MAIL_SUBJECTS[params.jobName][params.locale],
      html,
    });
  }
}
