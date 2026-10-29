import type { ConfigService } from '@nestjs/config';
import { FileMailTransport, ResendTransport, SmtpTransport } from '@nestjs/mail';
import { describe, expect, it } from 'vitest';

import { createMailTransport } from '@/common/mail/mail-transport.factory';
import type { EnvConfig } from '@/config/env.validation';

const configOf = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService<EnvConfig, true>;

describe('createMailTransport', () => {
  it('smtp 驱动构造 SmtpTransport', () => {
    expect(
      createMailTransport(configOf({ MAIL_TRANSPORT: 'smtp', MAIL_URL: 'smtp://user:pass@localhost:1025' })),
    ).toBeInstanceOf(SmtpTransport);
  });

  it('file 驱动构造 FileMailTransport', () => {
    expect(
      createMailTransport(configOf({ MAIL_TRANSPORT: 'file', MAIL_DIRECTORY: 'storage/tmp/mail' })),
    ).toBeInstanceOf(FileMailTransport);
  });

  it('resend 驱动需要 API Key', () => {
    expect(createMailTransport(configOf({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test' }))).toBeInstanceOf(
      ResendTransport,
    );
    expect(() => createMailTransport(configOf({ MAIL_TRANSPORT: 'resend' }))).toThrow(/RESEND_API_KEY/);
  });
});
