import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import type { EnvConfig } from '@/config/env.validation';
import { MailService } from './mail.service';

const currentDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

/**
 * 全局邮件模块
 *
 * 基础设施层集成 @nestjs-modules/mailer 与 HandlebarsAdapter。
 * 由 NestJS 容器统一管理 SMTP 连接池、邮件发送管道与 Handlebars 模板缓存。
 * 标记为 @Global()，业务模块与独立 Worker 进程无需重复 import 即可全局注入 MailService。
 */
@Global()
@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const fromAddress = config.get('MAIL_FROM_ADDRESS');
        const fromName = config.get('MAIL_FROM_NAME');

        return {
          transport: config.get('MAIL_URL'),
          defaults: {
            from: {
              name: fromName || undefined,
              address: fromAddress,
            },
          },
          template: {
            dir: join(currentDir, 'templates'),
            adapter: new HandlebarsAdapter(),
            options: {
              strict: true,
            },
          },
        };
      },
    }),
  ],
  providers: [MailService],
  exports: [MailService, MailerModule],
})
export class MailModule {}
