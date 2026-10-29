import { Injectable } from '@nestjs/common';
import type { Mailable, MailRenderContext } from '@nestjs/mail';

import { subjectFor } from '../mail.types';

/** 邮箱验证码上下文 */
export interface EmailOtpData {
  name: string;
  code: string;
}

/** 邮箱验证码邮件（5 分钟内有效） */
@Injectable()
export class EmailOtpMail implements Mailable<EmailOtpData> {
  render({ name, code }: EmailOtpData, { locale }: MailRenderContext) {
    return {
      subject: subjectFor('email-otp', locale),
      template: 'email-otp',
      context: { name, code },
    };
  }
}
