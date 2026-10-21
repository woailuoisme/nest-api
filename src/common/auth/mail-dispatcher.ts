import { Logger } from '@nestjs/common';

import { isProductionEnv } from '@/common/constants/app.constants';

const logger = new Logger('BetterAuth:MailDispatcher');

export type MailDispatcher = {
  queueVerificationEmail: (to: string, name: string, token: string, locale: 'zh' | 'en') => Promise<unknown>;
  queuePasswordResetEmail: (to: string, name: string, token: string, locale: 'zh' | 'en') => Promise<unknown>;
  queueEmailOTP?: (to: string, otp: string) => Promise<unknown>;
};

let mailDispatcher: MailDispatcher | null = null;

export function setBetterAuthMailDispatcher(dispatcher: MailDispatcher): void {
  mailDispatcher = dispatcher;
}

export function getBetterAuthMailDispatcher(): MailDispatcher | null {
  return mailDispatcher;
}

/**
 * 无调度器时的降级守卫：开发/测试允许把令牌打到日志，生产环境直接抛错。
 *
 * 生产环境不允许 OTP / 重置令牌 / 验证链接进入 stdout（容器日志会被集中采集）。
 */
function assertDispatcherRegistered(label: string): void {
  if (!isProductionEnv()) return;
  throw new Error(`${label}：邮件调度器未注册，拒绝在日志中输出敏感令牌`);
}

/**
 * 统一邮件分发处理通道：有调度器则走异步队列，无则降级为日志输出（仅非生产环境）
 */
export const authMailHandlers = {
  async sendResetPassword(params: { user: { email: string; name: string }; url: string; token: string }) {
    if (mailDispatcher) {
      await mailDispatcher.queuePasswordResetEmail(params.user.email, params.user.name, params.token, 'zh');
    } else {
      assertDispatcherRegistered('发送重置密码邮件失败');
      logger.log(`[BetterAuth:ResetPassword] User ${params.user.email}: ${params.url}`);
    }
  },

  async sendVerificationEmail(params: { user: { email: string; name: string }; url: string; token: string }) {
    if (mailDispatcher) {
      await mailDispatcher.queueVerificationEmail(params.user.email, params.user.name, params.token, 'zh');
    } else {
      assertDispatcherRegistered('发送验证邮件失败');
      logger.log(`[BetterAuth:VerifyEmail] User ${params.user.email}: ${params.url}`);
    }
  },

  async sendVerificationOTP(params: { email: string; otp: string }) {
    if (mailDispatcher?.queueEmailOTP) {
      await mailDispatcher.queueEmailOTP(params.email, params.otp);
    } else {
      assertDispatcherRegistered('发送邮箱验证码失败');
      logger.log(`[BetterAuth:EmailOTP] ${params.email}: ${params.otp}`);
    }
  },
};
