import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Mailable, MailRenderContext } from '@nestjs/mail';

import type { EnvConfig } from '@/config/env.validation';

import { subjectFor } from '../mail.types';

export interface WelcomeData {
  name: string;
}

@Injectable()
export class WelcomeMail implements Mailable<WelcomeData> {
  constructor(private readonly config: ConfigService<EnvConfig, true>) {}

  render({ name }: WelcomeData, { locale }: MailRenderContext) {
    return {
      subject: subjectFor('welcome', locale),
      template: 'welcome',
      context: { name, link: `${this.config.get('APP_URL')}/login` },
    };
  }
}
