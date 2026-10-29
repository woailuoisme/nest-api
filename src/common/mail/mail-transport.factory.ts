import type { ConfigService } from '@nestjs/config';
import { FileMailTransport, ResendTransport, SmtpTransport, type MailTransport } from '@nestjs/mail';

import type { EnvConfig } from '@/config/env.validation';

/** 按 `MAIL_TRANSPORT` 选择传输层：smtp（默认）/ file（测试与离线开发）/ resend */
export function createMailTransport(config: ConfigService<EnvConfig, true>): MailTransport {
  switch (config.get('MAIL_TRANSPORT')) {
    case 'file':
      return new FileMailTransport({ directory: config.get('MAIL_DIRECTORY') });
    case 'resend': {
      const apiKey = config.get('RESEND_API_KEY');
      if (!apiKey) {
        throw new Error('RESEND_API_KEY is required when MAIL_TRANSPORT=resend');
      }
      return new ResendTransport({ apiKey });
    }
    case 'smtp':
    default:
      return new SmtpTransport({ url: config.get('MAIL_URL'), pool: true });
  }
}
