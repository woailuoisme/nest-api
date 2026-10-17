import { Logger } from '@nestjs/common';
import { anonymous, emailOTP, lastLoginMethod, magicLink, phoneNumber, username } from 'better-auth/plugins';

import { authMailHandlers } from '../mail-dispatcher';

const logger = new Logger('BetterAuth:SocialAuth');

/**
 * 账号凭证扩展与无感验证插件集：包含用户名、手机号、魔法链接、邮箱 OTP、匿名账户绑定与最后登录方式
 */
export const socialAuthPlugins = [
  username(),
  phoneNumber(),
  magicLink({
    sendMagicLink: async ({ email, url }) => {
      await authMailHandlers.sendMagicLink({ email, url });
    },
  }),
  emailOTP({
    sendVerificationOTP: async ({ email, otp }) => {
      await authMailHandlers.sendVerificationOTP({ email, otp });
    },
  }),
  anonymous({
    emailDomainName: 'anonymous.placeholder.invalid',
    disableDeleteAnonymousUser: false,
    onLinkAccount: async ({ anonymousUser, newUser }) => {
      logger.log(`[BetterAuth:AnonymousLink] User ${anonymousUser.user.id} linked to ${newUser.user.id}`);
    },
  }),
  lastLoginMethod({
    storeInDatabase: true,
  }),
];
