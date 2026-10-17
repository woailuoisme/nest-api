import { type FactoryProvider, Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

import { INJECTION_TOKENS } from '@/common/constants/app.constants';
import type { EnvConfig } from '@/config/env.validation';

/** 邮件传输层注入令牌 */
export const MAIL_TRANSPORTER = INJECTION_TOKENS.MAIL_TRANSPORTER;

/**
 * 邮件传输层 provider（直连 nodemailer）
 *
 * 采用 nodemailer 原生 `createTransport(transport, defaults)` 两参形态：默认发件人作为第二参传入，
 * 而非与传输配置混在一起 —— 这正是移除 `@nestjs-modules/mailer` 后类型不再冲突的根因
 * （该包装层的 `MailerOptions.defaults` 仍按旧的 transport 选项类型声明，与 nodemailer 10 不同步）。
 */
export const mailTransporterProvider: FactoryProvider<Transporter> = {
  provide: MAIL_TRANSPORTER,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvConfig, true>): Transporter =>
    nodemailer.createTransport(config.get('MAIL_URL'), {
      from: {
        name: config.get('MAIL_FROM_NAME') || undefined,
        address: config.get('MAIL_FROM_ADDRESS'),
      },
    }),
};

/**
 * 邮件传输层生命周期托管
 *
 * transporter 持有 SMTP 连接池，属需显式释放的资源；工厂创建的实例不会被容器回调生命周期钩子，
 * 故以独立 provider 承接：应用关闭时调用 `close()`，避免连接池与 socket 拖住进程退出。
 */
@Injectable()
export class MailTransporterLifecycle implements OnApplicationShutdown {
  constructor(@Inject(MAIL_TRANSPORTER) private readonly transporter: Transporter) {}

  onApplicationShutdown(): void {
    this.transporter.close();
  }
}
