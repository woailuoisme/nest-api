import { apiKey } from '@better-auth/api-key';
import { bearer, oneTimeToken, twoFactor } from 'better-auth/plugins';

import { appName } from '@/common/constants/app.constants';

/**
 * 安全加固类插件集：包含 2FA、API Key、Bearer 令牌、一次性安全消费令牌
 */
export const securityPlugins = [
  twoFactor({
    // 认证器 App 中展示的发行方名称，跟随 APP_NAME
    issuer: appName(),
  }),
  apiKey(),
  bearer(),
  oneTimeToken(),
];
