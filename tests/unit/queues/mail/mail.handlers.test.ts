import { describe, expect, it, vi } from 'vitest';

const { createTransportMock, sendMailMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => {
    createTransportMock(...args);
    return { sendMail: sendMailMock };
  },
}));

import type { ConfigService } from '@nestjs/config';
import { MailHandlers } from '@/queues/mail/mail.handlers';
import type { MailTemplateService } from '@/queues/mail/mail.template.service';

/** 构造最小 ConfigService 代理（仅读取 MAIL_* 字段） */
function configOf(overrides: Record<string, unknown>) {
  const values: Record<string, unknown> = {
    MAIL_URL: 'smtp://user:pass@smtp.example.com:587',
    MAIL_FROM_ADDRESS: 'no-reply@example.com',
    MAIL_FROM_NAME: 'Example',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Record<string, unknown>, true>;
}

describe('MailHandlers SMTP initialization', () => {
  it('应使用 MAIL_URL 初始化 nodemailer transporter', () => {
    createTransportMock.mockClear();
    new MailHandlers(configOf({ MAIL_URL: 'smtp://user:secret@smtp.mailgun.org:587' }), {} as MailTemplateService);

    expect(createTransportMock).toHaveBeenCalledWith('smtp://user:secret@smtp.mailgun.org:587');
  });
});

describe('MailHandlers 发件人组装', () => {
  function handlers(overrides: Record<string, unknown>) {
    const template = { render: () => '<p>html</p>' } as unknown as MailTemplateService;
    sendMailMock.mockClear();
    return new MailHandlers(configOf(overrides), template);
  }

  it('MAIL_FROM_NAME + MAIL_FROM_ADDRESS 组装结构化 from', async () => {
    const mail = handlers({ MAIL_FROM_NAME: 'NestForge 团队', MAIL_FROM_ADDRESS: 'no-reply@example.com' });

    await mail.handleWelcome({ to: 'a@example.com', name: 'Alice', locale: 'zh' });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: { name: 'NestForge 团队', address: 'no-reply@example.com' } }),
    );
  });

  it('MAIL_FROM_NAME 为空时只传 address（不产生 "" 发件人）', async () => {
    const mail = handlers({ MAIL_FROM_NAME: '' });

    await mail.handleWelcome({ to: 'a@example.com', name: 'Alice', locale: 'zh' });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: { name: undefined, address: 'no-reply@example.com' } }),
    );
  });
});
