import type { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAIL_TRANSPORTER,
  MailTransporterLifecycle,
  mailTransporterProvider,
} from '@/common/mail/mail-transporter.provider';
import type { EnvConfig } from '@/config/env.validation';

describe('mailTransporterProvider', () => {
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'MAIL_URL') return 'smtp://localhost:1025';
      if (key === 'MAIL_FROM_ADDRESS') return 'no-reply@example.com';
      if (key === 'MAIL_FROM_NAME') return 'nest-api';
      return undefined;
    }),
  } as unknown as ConfigService<EnvConfig, true>;

  let createTransportSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // 直接对真实模块方法打 spy，而不是 vi.mock('nodemailer')：
    // 单元测试以 isolate:false 共享模块注册表，同 worker 内其他用例可能已先加载真实 nodemailer，
    // 此时后注册的 vi.mock 工厂不会生效（曾导致「单跑通过、全量失败」的顺序依赖）。spy 与加载顺序无关。
    createTransportSpy = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({} as Transporter);
  });

  /** 以受控 ConfigService 调用 provider 工厂 */
  const runFactory = (configService: ConfigService<EnvConfig, true>): unknown =>
    (mailTransporterProvider.useFactory as (config: ConfigService<EnvConfig, true>) => unknown)(configService);

  it('应以 nodemailer 的两参形态创建传输层：传输配置与默认发件人严格分离', () => {
    expect(mailTransporterProvider.provide).toBe(MAIL_TRANSPORTER);

    runFactory(config);

    expect(createTransportSpy).toHaveBeenCalledWith('smtp://localhost:1025', {
      from: { name: 'nest-api', address: 'no-reply@example.com' },
    });
  });

  it('未配置发件人名称时应以 undefined 传递（不写入空字符串污染 From 头）', () => {
    const configWithoutName = {
      get: vi.fn((key: string) => {
        if (key === 'MAIL_URL') return 'smtp://localhost:1025';
        if (key === 'MAIL_FROM_ADDRESS') return 'no-reply@example.com';
        return undefined;
      }),
    } as unknown as ConfigService<EnvConfig, true>;

    runFactory(configWithoutName);

    expect(createTransportSpy).toHaveBeenCalledWith('smtp://localhost:1025', {
      from: { name: undefined, address: 'no-reply@example.com' },
    });
  });

  it('应用关闭时应关闭传输层连接池', () => {
    const closeMock = vi.fn();
    const lifecycle = new MailTransporterLifecycle({ close: closeMock } as unknown as Transporter);

    lifecycle.onApplicationShutdown();

    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
