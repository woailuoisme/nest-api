import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Mailable, MailRenderContext } from '@nestjs/mail';

import type { EnvConfig } from '@/config/env.validation';

import { subjectFor } from '../mail.types';

export interface PasswordResetData {
  name: string;
  token: string;
  url?: string;
}

@Injectable()
export class PasswordResetMail implements Mailable<PasswordResetData> {
  constructor(private readonly config: ConfigService<EnvConfig, true>) {}

  render({ name, token, url }: PasswordResetData, { locale }: MailRenderContext) {
    const appUrl = this.config.get('APP_URL');
    return {
      subject: subjectFor('reset-password', locale),
      template: 'reset-password',
      context: {
        name,
        link: url ?? `${appUrl}/auth/reset-password?token=${token}`,
      },
    };
  }
}
