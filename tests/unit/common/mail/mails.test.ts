import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { PasswordResetMail } from '@/common/mail/mails/password-reset.mail';
import { VerifyEmailMail } from '@/common/mail/mails/verify-email.mail';
import { WelcomeMail } from '@/common/mail/mails/welcome.mail';
import type { EnvConfig } from '@/config/env.validation';

const config = {
  get: (key: string) => (key === 'APP_URL' ? 'https://app.example.com' : undefined),
} as unknown as ConfigService<EnvConfig, true>;

const renderContext = (locale?: string) => ({ locale, to: [] });

describe('Mailable classes', () => {
  it('VerifyEmailMail 构造验证链接并输出中英文主题', () => {
    const mail = new VerifyEmailMail(config);
    const zh = mail.render({ name: '张三', token: 'tok' }, renderContext('zh'));
    expect(zh).toMatchObject({ subject: '验证您的邮箱', template: 'verify-email' });
    expect(zh).toMatchObject({
      context: { name: '张三', link: 'https://app.example.com/auth/verify-email?token=tok' },
    });
    expect(mail.render({ name: 'Ada', token: 'tok' }, renderContext('en'))).toMatchObject({
      subject: 'Verify your email',
    });
  });

  it('PasswordResetMail 优先使用传入的完整链接', () => {
    const mail = new PasswordResetMail(config);
    expect(mail.render({ name: 'Ada', token: 'tok', url: 'https://x/reset?t=tok' }, renderContext('zh'))).toMatchObject(
      {
        context: { link: 'https://x/reset?t=tok' },
      },
    );
  });

  it('WelcomeMail 使用 APP_URL 登录页链接', () => {
    expect(new WelcomeMail(config).render({ name: 'Ada' }, renderContext('zh'))).toMatchObject({
      subject: '欢迎加入我们',
      context: { link: 'https://app.example.com/login' },
    });
  });
});
