import { apiKey } from '@better-auth/api-key';
import { passkey } from '@better-auth/passkey';
import { bearer, oneTimeToken, twoFactor } from 'better-auth/plugins';

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
