import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { EnvConfig } from '@/config/env.validation';
import { type MailJobData, MailJobName, type MailLocale } from './mail.jobs';
import { MailTemplateService } from './mail.template.service';

/** 邮件主题文案（与模板同语言） */
const SUBJECTS: Record<MailJobName, Record<MailLocale, string>> = {
  [MailJobName.VerifyEmail]: { zh: '验证您的邮箱', en: 'Verify your email' },
  [MailJobName.ResetPassword]: { zh: '重置密码', en: 'Reset your password' },
  [MailJobName.Welcome]: { zh: '欢迎加入 NestForge', en: 'Welcome to NestForge' },
};

/** 邮件消费处理 — SMTP 实际发送逻辑（消费者侧，与 Job 定义分离） */
@Injectable()
export class MailHandlers {
  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly templateService: MailTemplateService,
  ) {
    this.transporter = nodemailer.createTransport(config.get('MAIL_URL'));
  }

  /** 处理邮箱验证邮件 */
  async handleVerifyEmail({ to, name, token, locale }: MailJobData): Promise<void> {
    await this.send(
      to,
      SUBJECTS[MailJobName.VerifyEmail][locale],
      this.templateService.render('verify-email', locale, { name, token }),
    );
  }

  /** 处理密码重置邮件 */
  async handleResetPassword({ to, name, token, locale }: MailJobData): Promise<void> {
    await this.send(
      to,
      SUBJECTS[MailJobName.ResetPassword][locale],
      this.templateService.render('reset-password', locale, { name, token }),
    );
  }

  /** 处理欢迎邮件（注册后） */
  async handleWelcome({ to, name, locale }: MailJobData): Promise<void> {
    await this.send(
      to,
      SUBJECTS[MailJobName.Welcome][locale],
      this.templateService.render('welcome', locale, { name }),
    );
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    const fromAddress = this.config.get('MAIL_FROM_ADDRESS');
    const fromName = this.config.get('MAIL_FROM_NAME');
    await this.transporter.sendMail({
      // Laravel 风格：MAIL_FROM_NAME + MAIL_FROM_ADDRESS 组装发件人；结构化对象让 nodemailer 处理编码/引号
      from: { name: fromName || undefined, address: fromAddress },
      to,
      subject,
      html,
    });
  }
}
