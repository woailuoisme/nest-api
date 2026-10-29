import type { AuthenticationModuleOptions } from '@nestjs/authentication';
import type { ConfigService } from '@nestjs/config';

import type { EnvConfig } from '@/config/env.validation';

/** 逗号分隔的环境变量 → 去空白后的字符串列表（空段丢弃） */
function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** App / Cli 共用的认证模块配置（值全部来自 Zod 校验后的 ConfigService） */
export function createAuthenticationModuleOptions(config: ConfigService<EnvConfig, true>): AuthenticationModuleOptions {
  const appUrl = config.get('APP_URL');
  const trustedOrigins = splitList(config.get('TRUSTED_ORIGINS') ?? '');
  const mfaKeys = splitList(config.get('MFA_ENCRYPTION_KEYS'));

  return {
    session: {
      absoluteTtl: '7d',
      idleTtl: '1d',
      touchInterval: '1m',
      trustedOrigins: [appUrl, ...trustedOrigins],
      metadata: (request) => ({
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }),
    },
    accessToken: {
      key: config.get('JWT_SECRET'),
      issuer: appUrl,
      audience: config.get('APP_NAME'),
      ttl: '15m',
    },
    refreshToken: {
      ttl: '30d',
      absoluteTtl: '90d',
    },
    mfa: {
      issuer: config.get('APP_NAME'),
      encryption: { keys: mfaKeys },
    },
    emailVerification: { url: `${appUrl}/auth/verify-email` },
    passwordReset: { url: `${appUrl}/auth/reset-password` },
  };
}
