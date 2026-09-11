import { Logger } from '@nestjs/common';

const logger = new Logger('BetterAuth:MailDispatcher');

export type MailDispatcher = {
  queueVerificationEmail: (to: string, name: string, token: string, locale: 'zh' | 'en') => Promise<unknown>;
  queuePasswordResetEmail: (to: string, name: string, token: string, locale: 'zh' | 'en') => Promise<unknown>;
  queueMagicLinkEmail?: (to: string, url: string) => Promise<unknown>;
  queueEmailOTP?: (to: string, otp: string) => Promise<unknown>;
  queueOrgInvitationEmail?: (to: string, orgName: string, invitationId: string) => Promise<unknown>;
};

let mailDispatcher: MailDispatcher | null = null;

export function setBetterAuthMailDispatcher(dispatcher: MailDispatcher): void {
  mailDispatcher = dispatcher;
}

export function getBetterAuthMailDispatcher(): MailDispatcher | null {
  return mailDispatcher;
}

/**
 * 统一邮件分发处理通道：有调度器则走异步队列，无则降级为日志输出
 */
export const authMailHandlers = {
  async sendResetPassword(params: { user: { email: string; name: string }; url: string; token: string }) {
    if (mailDispatcher) {
      await mailDispatcher.queuePasswordResetEmail(params.user.email, params.user.name, params.token, 'zh');
    } else {
      logger.log(`[BetterAuth:ResetPassword] User ${params.user.email}: ${params.url}`);
    }
  },

  async sendVerificationEmail(params: { user: { email: string; name: string }; url: string; token: string }) {
    if (mailDispatcher) {
      await mailDispatcher.queueVerificationEmail(params.user.email, params.user.name, params.token, 'zh');
    } else {
      logger.log(`[BetterAuth:VerifyEmail] User ${params.user.email}: ${params.url}`);
    }
  },

  async sendMagicLink(params: { email: string; url: string }) {
    if (mailDispatcher?.queueMagicLinkEmail) {
      await mailDispatcher.queueMagicLinkEmail(params.email, params.url);
    } else {
      logger.log(`[BetterAuth:MagicLink] ${params.email}: ${params.url}`);
    }
  },

  async sendVerificationOTP(params: { email: string; otp: string }) {
    if (mailDispatcher?.queueEmailOTP) {
      await mailDispatcher.queueEmailOTP(params.email, params.otp);
    } else {
      logger.log(`[BetterAuth:EmailOTP] ${params.email}: ${params.otp}`);
    }
  },

  async sendInvitationEmail(params: { email: string; invitation: { id: string }; organization: { name: string } }) {
    if (mailDispatcher?.queueOrgInvitationEmail) {
      await mailDispatcher.queueOrgInvitationEmail(params.email, params.organization.name, params.invitation.id);
    } else {
      logger.log(
        `[BetterAuth:OrgInvitation] ${params.email} invited to ${params.organization.name}: ${params.invitation.id}`,
      );
    }
  },
};
