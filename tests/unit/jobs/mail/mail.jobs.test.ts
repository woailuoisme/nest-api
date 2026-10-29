import { describe, expect, it, vi } from 'vitest';

import { MailJobName, MailJobs } from '@/jobs/mail/mail.jobs';

describe('MailJobs (BullMQ 生产者)', () => {
  /** 构造生产者：只关心 queue.add 的 (name, payload, opts) */
  const createJobs = () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const jobs = new MailJobs({ add } as never);
    return { jobs, add };
  };

  it('验证邮件应入队并携带重试策略', async () => {
    const { jobs, add } = createJobs();
    await jobs.queueVerificationEmail('a@example.com', 'Ada', 'tok', 'zh', 'https://x/verify?t=tok');

    expect(add).toHaveBeenCalledWith(
      MailJobName.VerifyEmail,
      {
        to: { name: 'Ada', address: 'a@example.com' },
        locale: 'zh',
        data: { name: 'Ada', token: 'tok', url: 'https://x/verify?t=tok' },
      },
      { attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
    );
  });

  it('验证码与欢迎邮件使用各自的任务名', async () => {
    const { jobs, add } = createJobs();
    await jobs.queueEmailOtp('a@example.com', 'Ada', '123456', 'en');
    await jobs.queueWelcomeEmail('a@example.com', 'Ada', 'zh');

    expect(add.mock.calls[0]?.[0]).toBe(MailJobName.EmailOtp);
    expect(add.mock.calls[0]?.[1]).toMatchObject({ data: { name: 'Ada', code: '123456' }, locale: 'en' });
    expect(add.mock.calls[1]?.[0]).toBe(MailJobName.Welcome);
    expect(add.mock.calls[1]?.[1]).toMatchObject({ data: { name: 'Ada' } });
  });
});
