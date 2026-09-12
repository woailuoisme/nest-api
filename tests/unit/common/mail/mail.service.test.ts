import type { ConfigService } from '@nestjs/config';
import type { MailerService } from '@nestjs-modules/mailer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MailService } from '@/common/mail/mail.service';
import type { EnvConfig } from '@/config/env.validation';

describe('MailService', () => {
  let mailService: MailService;
  const sendMailMock = vi.fn();

  const mockMailerService = {
    sendMail: sendMailMock,
  } as unknown as MailerService;

  const mockConfigService = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'APP_URL') return 'https://app.example.com';
      return undefined;
    }),
  } as unknown as ConfigService<EnvConfig, true>;

  beforeEach(() => {
    vi.clearAllMocks();
    mailService = new MailService(mockMailerService, mockConfigService);
  });

  describe('sendVerificationEmail', () => {
    it('应正确渲染并发送中文邮箱验证邮件', async () => {
      sendMailMock.mockResolvedValueOnce({ messageId: 'msg-1' });

      await mailService.sendVerificationEmail({
        to: 'user@example.com',
        name: '张三',
        token: 'token-abc',
        locale: 'zh',
      });

      expect(sendMailMock).toHaveBeenCalledWith({
        to: 'user@example.com',
        subject: '验证您的邮箱',
        template: 'verify-email.zh.hbs',
        context: {
          name: '张三',
          link: 'https://app.example.com/auth/verify-email?token=token-abc',
        },
      });
    });

    it('应正确渲染并发送英文邮箱验证邮件', async () => {
      sendMailMock.mockResolvedValueOnce({ messageId: 'msg-2' });

      await mailService.sendVerificationEmail({
        to: 'user@example.com',
        name: 'Alice',
        token: 'token-xyz',
        locale: 'en',
      });

      expect(sendMailMock).toHaveBeenCalledWith({
        to: 'user@example.com',
        subject: 'Verify your email',
        template: 'verify-email.en.hbs',
        context: {
          name: 'Alice',
          link: 'https://app.example.com/auth/verify-email?token=token-xyz',
        },
      });
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('应正确发送密码重置邮件', async () => {
      sendMailMock.mockResolvedValueOnce({ messageId: 'msg-3' });

      await mailService.sendPasswordResetEmail({
        to: 'reset@example.com',
        name: '李四',
        token: 'reset-123',
        locale: 'zh',
      });

      expect(sendMailMock).toHaveBeenCalledWith({
        to: 'reset@example.com',
        subject: '重置密码',
        template: 'reset-password.zh.hbs',
        context: {
          name: '李四',
          link: 'https://app.example.com/auth/reset-password?token=reset-123',
        },
      });
    });
  });

  describe('sendWelcomeEmail', () => {
    it('应正确发送欢迎邮件且链接指向登录页', async () => {
      sendMailMock.mockResolvedValueOnce({ messageId: 'msg-4' });

      await mailService.sendWelcomeEmail({
        to: 'welcome@example.com',
        name: 'Bob',
        locale: 'en',
      });

      expect(sendMailMock).toHaveBeenCalledWith({
        to: 'welcome@example.com',
        subject: 'Welcome to NestForge',
        template: 'welcome.en.hbs',
        context: {
          name: 'Bob',
          link: 'https://app.example.com/login',
        },
      });
    });
  });

  describe('sendMail', () => {
    it('应透传底层 MailerService.sendMail', async () => {
      const customOptions = { to: 'custom@example.com', subject: 'Custom', html: '<p>Hi</p>' };
      sendMailMock.mockResolvedValueOnce({ messageId: 'msg-custom' });

      const result = await mailService.sendMail(customOptions);

      expect(sendMailMock).toHaveBeenCalledWith(customOptions);
      expect(result).toEqual({ messageId: 'msg-custom' });
    });
  });
});
