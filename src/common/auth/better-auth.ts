import { betterAuth } from 'better-auth';
import { authDatabaseAdapter } from './database';
import { authMailHandlers, setBetterAuthMailDispatcher } from './mail-dispatcher';
import { getAuthPlugins } from './plugins';

const baseURL = process.env.BETTER_AUTH_URL || process.env.APP_URL || 'http://localhost:4300';
const secret = process.env.BETTER_AUTH_SECRET || 'nestforge-better-auth-secret-key-32-chars!';

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
