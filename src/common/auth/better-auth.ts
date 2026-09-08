import { apiKey } from '@better-auth/api-key';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { passkey } from '@better-auth/passkey';
import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import {
  admin,
  anonymous,
  bearer,
  deviceAuthorization,
  emailOTP,
  genericOAuth,
  jwt,
  lastLoginMethod,
  magicLink,
  multiSession,
  oneTap,
  openAPI,
  organization,
  phoneNumber,
  twoFactor,
  username,
} from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { Role } from '@/common/constants/roles';
import * as schema from '@/database/drizzle/schema';

const logger = new Logger('BetterAuth');

// 1. 定义多层级 RBAC 角色与权限声明
const statement = {
  ...defaultStatements,
  ...adminAc.statements,
} as const;

const ac = createAccessControl(statement);

const USER = ac.newRole({});
const OPERATOR = ac.newRole({ ...adminAc.statements });
const ADMIN = ac.newRole({ ...adminAc.statements });
const SUPER_ADMIN = ac.newRole({ ...adminAc.statements });

// 2. 邮件任务分发委托钩子（在 AppModule 启动后注入 BullMQ MailJobs）
type MailDispatcher = {
  queueVerificationEmail: (to: string, name: string, token: string, locale: 'zh' | 'en') => Promise<unknown>;
  queuePasswordResetEmail: (to: string, name: string, token: string, locale: 'zh' | 'en') => Promise<unknown>;
};

let mailDispatcher: MailDispatcher | null = null;

export function setBetterAuthMailDispatcher(dispatcher: MailDispatcher) {
  mailDispatcher = dispatcher;
}

// 3. 数据库连接池单例（优先复用环境变量）
const connectionString = process.env.DB_URL || 'postgresql://localhost:5432/nestforge';
const pool = new Pool({ connectionString });
pool.on('error', (err) => {
  logger.error(`BetterAuth database pool error: ${err.message}`);
});
const db = drizzle(pool, { schema });

const baseURL = process.env.BETTER_AUTH_URL || process.env.APP_URL || 'http://localhost:4300';
let passkeyRpId = process.env.PASSKEY_RP_ID;
let passkeyOrigin = process.env.PASSKEY_ORIGIN;
if (!passkeyRpId || !passkeyOrigin) {
  try {
    const parsed = new URL(baseURL);
    passkeyRpId ??= parsed.hostname;
    passkeyOrigin ??= parsed.origin;
  } catch {
    passkeyRpId ??= 'localhost';
    passkeyOrigin ??= 'http://localhost:4300';
  }
}

// 4. 导出 Better Auth 核心实例
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  secret: process.env.BETTER_AUTH_SECRET || 'nestforge-better-auth-secret-key-32-chars!',
  baseURL,
  basePath: '/v1/auth',
  advanced: {
    database: {
      generateId: () => uuidv7(),
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url, token }) => {
      if (mailDispatcher) {
        await mailDispatcher.queuePasswordResetEmail(user.email, user.name, token, 'zh');
      } else {
        logger.log(`[BetterAuth:ResetPassword] User ${user.email}: ${url}`);
      }
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url, token }) => {
      if (mailDispatcher) {
        await mailDispatcher.queueVerificationEmail(user.email, user.name, token, 'zh');
      } else {
        logger.log(`[BetterAuth:VerifyEmail] User ${user.email}: ${url}`);
      }
    },
  },
  plugins: [
    admin({
      ac,
      roles: {
        SUPER_ADMIN,
        ADMIN,
        OPERATOR,
        USER,
      },
      adminRoles: [Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR],
      defaultRole: Role.USER,
    }),
    twoFactor({
      issuer: 'NestForge',
    }),
    username(),
    phoneNumber(),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        logger.log(`[BetterAuth:MagicLink] ${email}: ${url}`);
      },
    }),
    emailOTP({
      sendVerificationOTP: async ({ email, otp }) => {
        logger.log(`[BetterAuth:EmailOTP] ${email}: ${otp}`);
      },
    }),
    passkey({
      rpID: passkeyRpId,
      rpName: 'NestForge',
      origin: passkeyOrigin,
      registration: {
        requireSession: true,
      },
    }),
    oneTap({
      clientId: process.env.GOOGLE_CLIENT_ID || 'google-client-id',
      disableSignup: false,
    }),
    anonymous({
      emailDomainName: 'anonymous.placeholder.invalid',
      disableDeleteAnonymousUser: false,
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        logger.log(`[BetterAuth:AnonymousLink] User ${anonymousUser.user.id} linked to ${newUser.user.id}`);
      },
    }),
    genericOAuth({
      config: [
        {
          providerId: 'google',
          clientId: process.env.GOOGLE_CLIENT_ID || 'google-client-id',
          clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'google-client-secret',
        },
      ],
    }),
    apiKey(),
    organization({
      sendInvitationEmail: async ({ email, invitation, organization: org }) => {
        logger.log(`[BetterAuth:OrgInvitation] ${email} invited to ${org.name}: ${invitation.id}`);
      },
    }),
    bearer(),
    multiSession(),
    lastLoginMethod({
      storeInDatabase: true,
    }),
    jwt(),
    deviceAuthorization(),
    openAPI(),
  ],
});

export type Auth = typeof auth;
