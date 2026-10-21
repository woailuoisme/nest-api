import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeCnPhone, sendSmsOtp } from '@/common/sms/sms.service';

/**
 * 阿里云短信 SDK 为 CJS 产物，且仅在 sendSmsOtp 内动态 import：
 * 必须用模块级 mock 覆盖「真实成功路径」，否则只测到未配置凭证的分支，
 * CJS/ESM 互操作一旦在构建产物中表现不同，故障会直接落在登录链路上。
 */
const aliyunHarness = vi.hoisted(() => ({
  sendSms: vi.fn(),
  configCtor: vi.fn(),
  requestCtor: vi.fn(),
  clientCtor: vi.fn(),
  exportSendSmsRequest: true,
}));

vi.mock('@alicloud/dysmsapi20170525', () => {
  class SendSmsRequest {
    constructor(input: Record<string, unknown>) {
      aliyunHarness.requestCtor(input);
    }
  }

  class DysmsapiClient {
    constructor(config: unknown) {
      aliyunHarness.clientCtor(config);
    }

    sendSms(request: unknown) {
      return aliyunHarness.sendSms(request);
    }
  }

  return {
    default: { default: DysmsapiClient },
    // getter 用于模拟「具名导出探测失败」：验证服务层对 undefined 的显式兜底
    get SendSmsRequest() {
      return aliyunHarness.exportSendSmsRequest ? SendSmsRequest : undefined;
    },
  };
});

vi.mock('@alicloud/openapi-client', () => ({
  Config: class Config {
    constructor(input: Record<string, unknown>) {
      aliyunHarness.configCtor(input);
    }
  },
}));

const mockFetch = (body: string, status = 200) => {
  const spy = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal('fetch', spy);
  return spy;
};

describe('sms.service', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('normalizeCnPhone', () => {
    it('E.164 与 11 位号码归一化为大陆号码', () => {
      expect(normalizeCnPhone('+8613800138000')).toBe('13800138000');
      expect(normalizeCnPhone('13800138000')).toBe('13800138000');
      expect(normalizeCnPhone('+86 138-0013-8000')).toBe('13800138000');
    });

    it('非法号码应抛错', () => {
      expect(() => normalizeCnPhone('+15551234567')).toThrow(/手机号格式无效/);
      expect(() => normalizeCnPhone('12345')).toThrow(/手机号格式无效/);
    });
  });

  describe('smsbao（默认通道）', () => {
    it('成功返回 "0" 时不抛错，且请求携带 MD5 密码与验证码正文', async () => {
      vi.stubEnv('SMS_PROVIDER', 'smsbao');
      vi.stubEnv('SMSBAO_USER', 'demo-user');
      vi.stubEnv('SMSBAO_PASSWORD', 'secret-pass');
      const fetchSpy = mockFetch('0');

      await sendSmsOtp({ phone: '+8613800138000', code: '123456' });

      const url = String(fetchSpy.mock.calls[0][0]);
      expect(url).toContain('u=demo-user');
      expect(url).toContain(`p=${createHash('md5').update('secret-pass').digest('hex')}`);
      expect(url).toContain('m=13800138000');
      expect(decodeURIComponent(url)).toContain('123456');
    });

    it('未配置模板时使用带 APP_NAME 签名的默认正文', async () => {
      vi.stubEnv('SMS_PROVIDER', 'smsbao');
      vi.stubEnv('SMSBAO_USER', 'demo-user');
      vi.stubEnv('SMSBAO_PASSWORD', 'secret-pass');
      vi.stubEnv('APP_NAME', 'acme-core');
      const fetchSpy = mockFetch('0');

      await sendSmsOtp({ phone: '13800138000', code: '123456' });

      const url = decodeURIComponent(String(fetchSpy.mock.calls[0][0]));
      expect(url).toContain('【acme-core】');
      expect(url).toContain('123456');
    });

    it('显式配置 SMSBAO_CONTENT 时优先于默认模板', async () => {
      vi.stubEnv('SMS_PROVIDER', 'smsbao');
      vi.stubEnv('SMSBAO_USER', 'demo-user');
      vi.stubEnv('SMSBAO_PASSWORD', 'secret-pass');
      vi.stubEnv('APP_NAME', 'acme-core');
      vi.stubEnv('SMSBAO_CONTENT', '自定义签名 {code}');
      const fetchSpy = mockFetch('0');

      await sendSmsOtp({ phone: '13800138000', code: '123456' });

      const url = decodeURIComponent(String(fetchSpy.mock.calls[0][0]));
      expect(url).toContain('自定义签名 123456');
      expect(url).not.toContain('acme-core');
    });

    it('网关超时时应转为可读的超时错误', async () => {
      vi.stubEnv('SMS_PROVIDER', 'smsbao');
      vi.stubEnv('SMSBAO_USER', 'demo-user');
      vi.stubEnv('SMSBAO_PASSWORD', 'secret-pass');
      vi.stubEnv('SMS_TIMEOUT_MS', '1000');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
      );

      await expect(sendSmsOtp({ phone: '13800138000', code: '111111' })).rejects.toThrow(/短信发送超时（1000ms）/);
    });

    it('超时配置超过上限时应按 30s 截断', async () => {
      vi.stubEnv('SMS_PROVIDER', 'smsbao');
      vi.stubEnv('SMSBAO_USER', 'demo-user');
      vi.stubEnv('SMSBAO_PASSWORD', 'secret-pass');
      vi.stubEnv('SMS_TIMEOUT_MS', '60000');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'TimeoutError')));

      await expect(sendSmsOtp({ phone: '13800138000', code: '111111' })).rejects.toThrow(/短信发送超时（30000ms）/);
    });

    it('返回码非 0 时应抛错并带上返回码', async () => {
      vi.stubEnv('SMS_PROVIDER', 'smsbao');
      vi.stubEnv('SMSBAO_USER', 'demo-user');
      vi.stubEnv('SMSBAO_PASSWORD', 'secret-pass');
      mockFetch('30');

      await expect(sendSmsOtp({ phone: '13800138000', code: '111111' })).rejects.toThrow(/返回码 30/);
    });

    it('未配置凭证时应抛出明确错误', async () => {
      vi.stubEnv('SMS_PROVIDER', 'smsbao');
      vi.stubEnv('SMSBAO_USER', '');
      vi.stubEnv('SMSBAO_PASSWORD', '');

      await expect(sendSmsOtp({ phone: '13800138000', code: '111111' })).rejects.toThrow(/SMSBAO_USER/);
    });
  });

  describe('aliyun', () => {
    const stubAliyunEnv = () => {
      vi.stubEnv('SMS_PROVIDER', 'aliyun');
      vi.stubEnv('ALIYUN_SMS_ACCESS_KEY_ID', 'ak-id');
      vi.stubEnv('ALIYUN_SMS_ACCESS_KEY_SECRET', 'ak-secret');
      vi.stubEnv('ALIYUN_SMS_SIGN_NAME', 'nest-api');
      vi.stubEnv('ALIYUN_SMS_TEMPLATE_CODE', 'SMS_000001');
    };

    it('未配置凭证时应抛出明确错误', async () => {
      vi.stubEnv('SMS_PROVIDER', 'aliyun');
      vi.stubEnv('ALIYUN_SMS_ACCESS_KEY_ID', '');

      await expect(sendSmsOtp({ phone: '13800138000', code: '111111' })).rejects.toThrow(/ALIYUN_SMS_ACCESS_KEY_ID/);
    });

    it('配置齐全时应下发归一化号码与模板变量，并复用统一超时配置', async () => {
      stubAliyunEnv();
      vi.stubEnv('SMS_TIMEOUT_MS', '3000');
      aliyunHarness.sendSms.mockResolvedValue({ body: { code: 'OK' } });

      await sendSmsOtp({ phone: '+86 138-0013-8000', code: '654321' });

      expect(aliyunHarness.requestCtor).toHaveBeenCalledWith({
        phoneNumbers: '13800138000',
        signName: 'nest-api',
        templateCode: 'SMS_000001',
        templateParam: '{"code":"654321"}',
      });
      expect(aliyunHarness.configCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          accessKeyId: 'ak-id',
          accessKeySecret: 'ak-secret',
          endpoint: 'dysmsapi.aliyuncs.com',
          connectTimeout: 3000,
          readTimeout: 3000,
        }),
      );
      expect(aliyunHarness.sendSms).toHaveBeenCalledTimes(1);
    });

    it('返回码非 OK 时应抛错并带上服务商错误码', async () => {
      stubAliyunEnv();
      aliyunHarness.sendSms.mockResolvedValue({
        body: { code: 'isv.BUSINESS_LIMIT_CONTROL', message: '触发流控' },
      });

      await expect(sendSmsOtp({ phone: '13800138000', code: '111111' })).rejects.toThrow(/isv\.BUSINESS_LIMIT_CONTROL/);
    });

    it('SDK 未导出 SendSmsRequest 时应显式报互操作错误而非 TypeError', async () => {
      stubAliyunEnv();
      aliyunHarness.exportSendSmsRequest = false;

      try {
        await expect(sendSmsOtp({ phone: '13800138000', code: '111111' })).rejects.toThrow(/SendSmsRequest/);
      } finally {
        aliyunHarness.exportSendSmsRequest = true;
      }
    });
  });

  it('未知服务商应抛错', async () => {
    vi.stubEnv('SMS_PROVIDER', 'unknown');

    await expect(sendSmsOtp({ phone: '13800138000', code: '111111' })).rejects.toThrow(/未知的短信服务商/);
  });
});
