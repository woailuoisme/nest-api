import { emailOTP, lastLoginMethod, phoneNumber, username } from 'better-auth/plugins';

import { normalizeCnPhone, sendSmsOtp } from '@/common/sms/sms.service';

import { authMailHandlers } from '../mail-dispatcher';

/**
 * 账号凭证扩展与无感验证插件集：用户名、手机号、邮箱 OTP 与最后登录方式
 */
export const socialAuthPlugins = [
  username(),
  // 手机号登录：通道由 SMS_PROVIDER 决定（smsbao 默认 / aliyun），未配置凭证时发码报错
  phoneNumber({
    // 号码合法性必须在 Better Auth 写入 verification 行、调用短信网关之前判定：
    // 若只依赖 sendOTP 内抛错，非法号码会先落一条验证码记录，再以 5xx 返回（语义应为 400）
    phoneNumberValidator: (phone) => {
      try {
        normalizeCnPhone(phone);
        return true;
      } catch {
        return false;
      }
    },
    sendOTP: ({ phoneNumber, code }) => sendSmsOtp({ phone: phoneNumber, code }),
  }),
  emailOTP({
    sendVerificationOTP: authMailHandlers.sendVerificationOTP,
  }),
  lastLoginMethod({
    storeInDatabase: true,
  }),
];
