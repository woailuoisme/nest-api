import { betterAuth } from 'better-auth';

import { DEV_ONLY_AUTH_SECRET, isProductionEnv } from '@/common/constants/app.constants';

import { authDatabaseAdapter } from './database';
import { authMailHandlers, setBetterAuthMailDispatcher } from './mail-dispatcher';
import { getAuthPlugins } from './plugins';

const baseURL = process.env.BETTER_AUTH_URL || process.env.APP_URL || 'http://localhost:4300';

/**
 * 签名密钥：开发/测试允许回退公开占位值，生产环境必须显式配置。
 *
 * 在本模块加载期即抛错（早于 ConfigModule 校验），双保险确保会话签名密钥永远不会回退到公开值。
 * 生产环境的「不得等于公开值」另由 `env.validation.ts` 拦一道。
 */
const secret = process.env.BETTER_AUTH_SECRET || (isProductionEnv() ? undefined : DEV_ONLY_AUTH_SECRET);
if (!secret) {
  throw new Error('BETTER_AUTH_SECRET 未配置：生产环境禁止使用公开默认密钥');
}

/**
 * 生产级 Better Auth 核心实例
 */
export const auth = betterAuth({
  database: authDatabaseAdapter,
  secret,
  baseURL,
  basePath: '/v1/auth',
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url, token }) => {
      await authMailHandlers.sendResetPassword({ user, url, token });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url, token }) => {
      await authMailHandlers.sendVerificationEmail({ user, url, token });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 天生命周期
    updateAge: 60 * 60 * 24, // 1 天滑动续期间隔
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
  },
  plugins: getAuthPlugins(),
});

export type Auth = typeof auth;

// 向下兼容导出邮件调度器注入接口
export { setBetterAuthMailDispatcher };
