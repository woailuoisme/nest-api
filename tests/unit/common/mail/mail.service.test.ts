import type { ConfigService } from '@nestjs/config';
import type { SendMailOptions, Transporter } from 'nodemailer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailTemplateRenderer } from '@/common/mail/mail-template.renderer';
import { MailService } from '@/common/mail/mail.service';
import type { EnvConfig } from '@/config/env.validation';

describe('MailService', () => {
  let mailService: MailService;
  const sendMailMock = vi.fn();
  const renderMock = vi.fn();

  const mockTransporter = { sendMail: sendMailMock } as unknown as Transporter;
  const mockRenderer = { render: renderMock } as unknown as MailTemplateRenderer;

  const mockConfigService = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'APP_URL') return 'https://app.example.com';
      return undefined;
    }),
  } as unknown as ConfigService<EnvConfig, true>;

  beforeEach(() => {
    vi.clearAllMocks();
    renderMock.mockResolvedValue('<html><body>rendered</body></html>');
    mailService = new MailService(mockTransporter, mockRenderer, mockConfigService);
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

      expect(renderMock).toHaveBeenCalledWith('verify-email.zh.hbs', {
        name: '张三',
        link: 'https://app.example.com/auth/verify-email?token=token-abc',
      });
      expect(sendMailMock).toHaveBeenCalledWith({
        to: 'user@example.com',
        subject: '验证您的邮箱',
        html: '<html><body>rendered</body></html>',
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

      expect(renderMock).toHaveBeenCalledWith('verify-email.en.hbs', {
        name: 'Alice',
        link: 'https://app.example.com/auth/verify-email?token=token-xyz',
      });
      expect(sendMailMock).toHaveBeenCalledWith({
        to: 'user@example.com',
        subject: 'Verify your email',
        html: '<html><body>rendered</body></html>',
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

      expect(renderMock).toHaveBeenCalledWith('reset-password.zh.hbs', {
        name: '李四',
        link: 'https://app.example.com/auth/reset-password?token=reset-123',
      });
      expect(sendMailMock).toHaveBeenCalledWith({
        to: 'reset@example.com',
        subject: '重置密码',
        html: '<html><body>rendered</body></html>',
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

      expect(renderMock).toHaveBeenCalledWith('welcome.en.hbs', {
        name: 'Bob',
        link: 'https://app.example.com/login',
      });
      expect(sendMailMock).toHaveBeenCalledWith({
        to: 'welcome@example.com',
        subject: 'Welcome to NestForge',
        html: '<html><body>rendered</body></html>',
      });
    });
  });

  describe('sendMail', () => {
    it('应透传底层 nodemailer 传输层', async () => {
      const customOptions: SendMailOptions = { to: 'custom@example.com', subject: 'Custom', html: '<p>Hi</p>' };
      sendMailMock.mockResolvedValueOnce({ messageId: 'msg-custom' });

      const result = await mailService.sendMail(customOptions);

      expect(sendMailMock).toHaveBeenCalledWith(customOptions);
      expect(result).toEqual({ messageId: 'msg-custom' });
    });
  });

  describe('模板渲染失败', () => {
    it('渲染失败时应抛出错误且不发送邮件（交由队列重试，不静默降级为空正文）', async () => {
      renderMock.mockRejectedValueOnce(new Error('模板缺少变量: link'));

      await expect(
        mailService.sendWelcomeEmail({ to: 'welcome@example.com', name: 'Bob', locale: 'en' }),
      ).rejects.toThrow('模板缺少变量: link');
      expect(sendMailMock).not.toHaveBeenCalled();
    });
  });
});
