import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailModule as NestMailModule } from '@nestjs/mail';

import type { EnvConfig } from '@/config/env.validation';

import { HandlebarsTemplateEngine } from './handlebars-template.engine';
import { MailEventsLogger } from './mail-events.logger';
import { createMailTransport } from './mail-transport.factory';
import { EmailOtpMail } from './mails/email-otp.mail';
import { PasswordResetMail } from './mails/password-reset.mail';
import { VerifyEmailMail } from './mails/verify-email.mail';
import { WelcomeMail } from './mails/welcome.mail';

/**
 * 官方 `@nestjs/mail` 统一装配。
 *
 * - 传输层按 `MAIL_TRANSPORT` 选择 SMTP / file / Resend；
 * - 模板引擎沿用 MJML → `.hbs`（自定义 `MailTemplateEngine`）；
 * - 投递通道是 BullMQ `mail` 队列：API 进程只入队，Worker 进程由 `MailProcessor` 消费。
 */
@Module({})
export class MailModule {
  static forRoot(): DynamicModule {
    return {
      module: MailModule,
      imports: [
        NestMailModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService<EnvConfig, true>) => {
            const name = config.get('MAIL_FROM_NAME');
            const address = config.get('MAIL_FROM_ADDRESS');
            return {
              transport: createMailTransport(config),
              templates: new HandlebarsTemplateEngine(),
              from: name ? { name, address } : address,
            };
          },
        }),
      ],
      providers: [MailEventsLogger, VerifyEmailMail, PasswordResetMail, EmailOtpMail, WelcomeMail],
      exports: [NestMailModule, VerifyEmailMail, PasswordResetMail, EmailOtpMail, WelcomeMail],
    };
  }
}
