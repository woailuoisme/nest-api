export type MailLocale = 'zh' | 'en';

export type MailTemplateName = 'verify-email' | 'reset-password' | 'welcome' | 'email-otp';

/** 邮件主题（模板语言与主题文案一一对应） */
export const MAIL_SUBJECTS: Record<MailTemplateName, Record<MailLocale, string>> = {
  'verify-email': { zh: '验证您的邮箱', en: 'Verify your email' },
  'reset-password': { zh: '重置密码', en: 'Reset your password' },
  welcome: { zh: '欢迎加入我们', en: 'Welcome aboard' },
  'email-otp': { zh: '邮箱验证码', en: 'Your verification code' },
};

export function subjectFor(template: MailTemplateName, locale: string | undefined): string {
  return MAIL_SUBJECTS[template][locale === 'en' ? 'en' : 'zh'];
}

export interface MailRecipient {
  name: string;
  address: string;
}

export interface MailPayload<T> {
  to: MailRecipient;
  locale: MailLocale;
  data: T;
}
