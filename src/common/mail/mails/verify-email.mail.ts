import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Mailable, MailRenderContext } from '@nestjs/mail';

import type { EnvConfig } from '@/config/env.validation';

import { subjectFor } from '../mail.types';

export interface VerifyEmailData {
  name: string;
  token: string;
  url?: string;
}

@Injectable()
export class VerifyEmailMail implements Mailable<VerifyEmailData> {
  constructor(private readonly config: ConfigService<EnvConfig, true>) {}

  render({ name, token, url }: VerifyEmailData, { locale }: MailRenderContext) {
    const appUrl = this.config.get('APP_URL');
    return {
      subject: subjectFor('verify-email', locale),
      template: 'verify-email',
      context: {
        name,
        link: url ?? `${appUrl}/auth/verify-email?token=${token}`,
      },
    };
  }
}
