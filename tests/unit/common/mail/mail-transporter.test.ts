import type { ConfigService } from '@nestjs/config';
import type { Transporter } from 'nodemailer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAIL_TRANSPORTER,
  MailTransporterLifecycle,
  mailTransporterProvider,
} from '@/common/mail/mail-transporter.provider';
import type { EnvConfig } from '@/config/env.validation';

const createTransportMock = vi.fn();

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (...args: unknown[]) => createTransportMock(...args),
  },
}));

describe('mailTransporterProvider', () => {
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'MAIL_URL') return 'smtp://localhost:1025';
      if (key === 'MAIL_FROM_ADDRESS') return 'no-reply@nestforge.dev';
      if (key === 'MAIL_FROM_NAME') return 'NestForge';
      return undefined;
    }),
  } as unknown as ConfigService<EnvConfig, true>;

  /** 以受控 ConfigService 调用 provider 工厂 */
  const runFactory = (configService: ConfigService<EnvConfig, true>): unknown =>
    (mailTransporterProvider.useFactory as (config: ConfigService<EnvConfig, true>) => unknown)(configService);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应以 nodemailer 的两参形态创建传输层：传输配置与默认发件人严格分离', () => {
    expect(mailTransporterProvider.provide).toBe(MAIL_TRANSPORTER);

    runFactory(config);

    expect(createTransportMock).toHaveBeenCalledWith('smtp://localhost:1025', {
      from: { name: 'NestForge', address: 'no-reply@nestforge.dev' },
    });
  });

  it('未配置发件人名称时应以 undefined 传递（不写入空字符串污染 From 头）', () => {
    const configWithoutName = {
      get: vi.fn((key: string) => {
        if (key === 'MAIL_URL') return 'smtp://localhost:1025';
        if (key === 'MAIL_FROM_ADDRESS') return 'no-reply@nestforge.dev';
        return undefined;
      }),
    } as unknown as ConfigService<EnvConfig, true>;

    runFactory(configWithoutName);

    expect(createTransportMock).toHaveBeenCalledWith('smtp://localhost:1025', {
      from: { name: undefined, address: 'no-reply@nestforge.dev' },
    });
  });

  it('应用关闭时应关闭传输层连接池', () => {
    const closeMock = vi.fn();
    const lifecycle = new MailTransporterLifecycle({ close: closeMock } as unknown as Transporter);

    lifecycle.onApplicationShutdown();

    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
