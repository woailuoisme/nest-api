import { apiKey } from '@better-auth/api-key';
import { passkey } from '@better-auth/passkey';
import { bearer, oneTimeToken, twoFactor } from 'better-auth/plugins';

const baseURL = process.env.BETTER_AUTH_URL || process.env.APP_URL || 'http://localhost:4300';

/** 解析基址为 URL；非法基址回退本地默认值，保证 Passkey 配置始终可推导 */
function parseBaseUrl(base: string): URL {
  try {
    return new URL(base);
  } catch {
    return new URL('http://localhost:4300');
  }
}

// Passkey 的 rpID / origin 未显式配置时，按基址自动推导（RP ID 必须是站点域名，不含端口）
const parsedBaseUrl = parseBaseUrl(baseURL);
const passkeyRpId = process.env.PASSKEY_RP_ID ?? parsedBaseUrl.hostname;
const passkeyOrigin = process.env.PASSKEY_ORIGIN ?? parsedBaseUrl.origin;

/**
 * 安全加固类插件集：包含 2FA、FIDO2 Passkey、API Key、Bearer 令牌、一次性安全消费令牌
 */
export const securityPlugins = [
  twoFactor({
    issuer: 'NestForge',
  }),
  passkey({
    rpID: passkeyRpId,
    rpName: 'NestForge',
    origin: passkeyOrigin,
    registration: {
      requireSession: true,
    },
  }),
  apiKey(),
  bearer(),
  oneTimeToken(),
];
