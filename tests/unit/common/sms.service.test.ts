import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeCnPhone, sendSmsOtp } from '@/common/sms/sms.service';

const ENV_KEYS = ['SMS_PROVIDER', 'SMSBAO_USER', 'SMSBAO_PASSWORD', 'SMSBAO_CONTENT', 'SMS_TIMEOUT_MS'] as const;

describe('sms.service', () => {
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) original[key] = process.env[key];

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    vi.restoreAllMocks();
  });

  describe('normalizeCnPhone', () => {
    it('应接受大陆 11 位与 +86 E.164', () => {
      expect(normalizeCnPhone('13800138000')).toBe('13800138000');
      expect(normalizeCnPhone('+8613800138000')).toBe('13800138000');
    });

    it('应拒绝非 86 国际号码与非法号码', () => {
      expect(() => normalizeCnPhone('+12025550123')).toThrow(/仅支持中国大陆号码/);
      expect(() => normalizeCnPhone('12345')).toThrow(/需大陆 11 位手机号/);
    });
  });

  describe('sendSmsOtp', () => {
    it('未知服务商应抛出明确错误', async () => {
      process.env.SMS_PROVIDER = 'unknown';
      await expect(sendSmsOtp({ phone: '13800138000', code: '123456' })).rejects.toThrow(/未知的短信服务商/);
    });

    it('非法号码优先于通道配置错误', async () => {
      process.env.SMS_PROVIDER = 'smsbao';
      delete process.env.SMSBAO_USER;
      await expect(sendSmsOtp({ phone: '12345', code: '123456' })).rejects.toThrow(/手机号格式无效/);
    });

    it('smsbao 未配置凭证应报错', async () => {
      process.env.SMS_PROVIDER = 'smsbao';
      delete process.env.SMSBAO_USER;
      delete process.env.SMSBAO_PASSWORD;
      await expect(sendSmsOtp({ phone: '13800138000', code: '123456' })).rejects.toThrow(/SMSBAO_USER/);
    });

    it('smsbao 返回 "0" 视为发送成功', async () => {
      process.env.SMS_PROVIDER = 'smsbao';
      process.env.SMSBAO_USER = 'demo';
      process.env.SMSBAO_PASSWORD = 'secret';
      process.env.SMSBAO_CONTENT = '验证码 {code}';

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('0', { status: 200 }));

      await expect(sendSmsOtp({ phone: '+8613800138000', code: '654321' })).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('m=13800138000'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('smsbao 非 "0" 返回码应报错', async () => {
      process.env.SMS_PROVIDER = 'smsbao';
      process.env.SMSBAO_USER = 'demo';
      process.env.SMSBAO_PASSWORD = 'secret';

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('-2', { status: 200 }));

      await expect(sendSmsOtp({ phone: '13800138000', code: '123456' })).rejects.toThrow(/SMSBao 发送失败/);
    });

    it('aliyun 未配置凭证应报错（不触发 SDK 加载）', async () => {
      process.env.SMS_PROVIDER = 'aliyun';
      await expect(sendSmsOtp({ phone: '13800138000', code: '123456' })).rejects.toThrow(/ALIYUN_SMS_ACCESS_KEY_ID/);
    });
  });
});
