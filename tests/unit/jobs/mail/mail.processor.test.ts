import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailService } from '@/common/mail/mail.service';
import { type MailJobData, MailJobName } from '@/jobs/mail/mail.jobs';
import { MailProcessor } from '@/jobs/mail/mail.processor';

describe('MailProcessor', () => {
  let processor: MailProcessor;

  const mockMailService = {
    sendVerificationEmail: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    sendWelcomeEmail: vi.fn(),
  } as unknown as MailService;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new MailProcessor(mockMailService);
  });

  it('应正确分发 VerifyEmail 任务', async () => {
    const jobData: MailJobData = {
      to: 'user@example.com',
      name: 'Alice',
      token: 'tok-123',
      locale: 'zh',
    };
    const job = {
      name: MailJobName.VerifyEmail,
      data: jobData,
    } as Job<MailJobData>;

    await processor.process(job);

    expect(mockMailService.sendVerificationEmail).toHaveBeenCalledWith(jobData);
  });

  it('应正确分发 ResetPassword 任务', async () => {
    const jobData: MailJobData = {
      to: 'user@example.com',
      name: 'Alice',
      token: 'tok-reset',
      locale: 'en',
    };
    const job = {
      name: MailJobName.ResetPassword,
      data: jobData,
    } as Job<MailJobData>;

    await processor.process(job);

    expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalledWith(jobData);
  });

  it('应正确分发 Welcome 任务', async () => {
    const jobData: MailJobData = {
      to: 'user@example.com',
      name: 'Alice',
      locale: 'zh',
    };
    const job = {
      name: MailJobName.Welcome,
      data: jobData,
    } as Job<MailJobData>;

    await processor.process(job);

    expect(mockMailService.sendWelcomeEmail).toHaveBeenCalledWith(jobData);
  });

  it('未知任务名称应安全略过不抛错', async () => {
    const job = {
      name: 'unknown-task',
      data: { to: 'a@b.com', name: 'A', locale: 'zh' },
    } as unknown as Job<MailJobData>;

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(mockMailService.sendVerificationEmail).not.toHaveBeenCalled();
    expect(mockMailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(mockMailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});
