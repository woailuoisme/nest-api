import type { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSessionSignature } from '@/common/wechat/miniprogram/crypto/session-signature';
import { RealMiniprogramDriver } from '@/common/wechat/miniprogram/drivers/real.driver';
import { MiniprogramException } from '@/common/wechat/miniprogram/miniprogram.exception';

const APP_ID = 'wx-test-appid';
const APP_SECRET = 'test-secret';
const API_BASE = 'https://api.weixin.qq.com';
/** PNG 魔数，用于验证二进制应答未被错误当作 JSON 处理 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** 静默 Logger：避免用例输出被驱动的日志刷屏 */
function createSilentLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

/** 构造伪造的 fetch 应答（文本与二进制共用同一缓冲区，保证两处视图一致） */
function fakeResponse(body: string | Buffer, status = 200, contentType = 'application/json'): Response {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return {
    status,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
  } as unknown as Response;
}

/** 构造 JSON 应答 */
function jsonResponse(payload: unknown, status = 200): Response {
  return fakeResponse(JSON.stringify(payload), status);
}

/** 断言 promise 以指定错误码的小程序领域异常拒绝 */
async function expectRejection(promise: Promise<unknown>, code: string): Promise<MiniprogramException> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(MiniprogramException);
  expect((caught as MiniprogramException).miniprogramCode).toBe(code);
  return caught as MiniprogramException;
}

let fetchMock: ReturnType<typeof vi.fn>;
let driver: RealMiniprogramDriver;

/** 读取第 index 次 fetch 调用的 URL、请求体与请求头 */
function readRequest(index = 0): { url: string; body: Record<string, unknown>; headers: Record<string, string> } {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return {
    url,
    body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
    headers: (init.headers ?? {}) as Record<string, string>,
  };
}

/**
 * 预置 access_token
 *
 * 先消费一次 stable_token 应答并清空调用记录，使后续断言只观察业务请求，
 * 避免每处用例都要为凭证获取额外排队一条应答。
 */
async function primeToken(): Promise<void> {
  fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'PRIMED_TOKEN', expires_in: 7200 }));
  await driver.getAccessToken();
  fetchMock.mockClear();
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  driver = new RealMiniprogramDriver({
    appid: APP_ID,
    appSecret: APP_SECRET,
    logger: createSilentLogger(),
    timeoutMs: 200,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('小程序真实驱动：接口调用凭据', () => {
  it('应以普通模式调用 stable_token，且重复获取命中缓存', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'TOKEN', expires_in: 7200 }));

    await expect(driver.getAccessToken()).resolves.toBe('TOKEN');
    await expect(driver.getAccessToken()).resolves.toBe('TOKEN');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, body } = readRequest();
    expect(url).toBe(`${API_BASE}/cgi-bin/stable_token`);
    // 普通模式不传 force_refresh，避免触发官方「每天 20 次且间隔 30 秒」的强刷限制
    expect(body).toEqual({ grant_type: 'client_credential', appid: APP_ID, secret: APP_SECRET });
  });

  it('refreshAccessToken 应以 force_refresh 强刷', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'FORCED', expires_in: 7200 }));

    await expect(driver.refreshAccessToken()).resolves.toBe('FORCED');

    const { body } = readRequest();
    expect(body).toMatchObject({ force_refresh: true });
  });

  it('应答缺少 expires_in 时应按官方默认有效期缓存', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'TOKEN' }));

    await expect(driver.getAccessToken()).resolves.toBe('TOKEN');
    await expect(driver.getAccessToken()).resolves.toBe('TOKEN');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('小程序真实驱动：登录', () => {
  it('code2Session 应以 appid + secret 直接鉴权，不携带 access_token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ openid: 'o1', session_key: 'sk', unionid: 'u1' }));

    await expect(driver.code2Session('JS_CODE')).resolves.toEqual({ openid: 'o1', sessionKey: 'sk', unionid: 'u1' });

    const { url, headers } = readRequest();
    expect(url).toContain('/sns/jscode2session');
    expect(url).toContain(`appid=${APP_ID}`);
    expect(url).toContain('js_code=JS_CODE');
    expect(url).toContain('grant_type=authorization_code');
    expect(url).not.toContain('access_token');
    expect(headers['User-Agent']).toContain('nestforge-miniprogram');
  });

  it('code2Session 应答缺少 unionid 时不应产出 undefined 字段', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ openid: 'o1', session_key: 'sk' }));

    await expect(driver.code2Session('JS_CODE')).resolves.toEqual({ openid: 'o1', sessionKey: 'sk' });
  });

  it('code 无效（40029）应转译为 400 而非静默返回', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40029, errmsg: 'invalid code' }));

    const error = await expectRejection(driver.code2Session('JS_CODE'), '40029');
    expect(error.getStatus()).toBe(400);
  });

  it('登录态校验应以 hmac_sha256(session_key, "") 作为签名', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await expect(driver.checkSessionKey('o1', 'session-key')).resolves.toBe(true);

    const { url } = readRequest();
    expect(url).toContain('/wxa/checksession');
    expect(url).toContain(`signature=${buildSessionSignature('session-key')}`);
    expect(url).toContain('sig_method=hmac_sha256');
    expect(url).toContain('openid=o1');
  });

  it('登录态失效（87007 / 87009）应返回 false 而非抛错', async () => {
    await primeToken();

    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 87007, errmsg: 'session_key is not existd or expired' }));
    await expect(driver.checkSessionKey('o1', 'sk')).resolves.toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 87009, errmsg: 'invalid signature' }));
    await expect(driver.checkSessionKey('o1', 'sk')).resolves.toBe(false);
  });

  it('重置登录态应返回重置后的新 session_key 并保留 openid', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok', openid: 'o1', session_key: 'NEW_SK' }));

    await expect(driver.resetUserSessionKey('o1', 'sk')).resolves.toEqual({ openid: 'o1', sessionKey: 'NEW_SK' });

    expect(readRequest().url).toContain('/wxa/resetusersessionkey');
  });
});

describe('小程序真实驱动：手机号', () => {
  it('应返回归一化的手机号信息', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        errcode: 0,
        errmsg: 'ok',
        phone_info: {
          phoneNumber: '8613800138000',
          purePhoneNumber: '13800138000',
          countryCode: '86',
          watermark: { timestamp: 1700000000, appid: APP_ID },
        },
      }),
    );

    const info = await driver.getPhoneNumber({ code: 'PHONE_CODE' });

    expect(info).toEqual({
      phoneNumber: '8613800138000',
      purePhoneNumber: '13800138000',
      countryCode: '86',
      watermark: { timestamp: 1700000000, appid: APP_ID },
    });

    const { url, body } = readRequest();
    expect(url).toContain('/wxa/business/getuserphonenumber');
    expect(url).toContain('access_token=PRIMED_TOKEN');
    expect(body).toEqual({ code: 'PHONE_CODE' });
  });

  it('传入 openid 时应参与请求体以校验绑定关系', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        errcode: 0,
        errmsg: 'ok',
        phone_info: { phoneNumber: '8613800138000', purePhoneNumber: '13800138000', countryCode: '86' },
      }),
    );

    await driver.getPhoneNumber({ code: 'PHONE_CODE', openid: 'o1' });

    expect(readRequest().body).toEqual({ code: 'PHONE_CODE', openid: 'o1' });
  });

  it('应答缺少 phone_info 时应按应答异常上报而非返回空值', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await expectRejection(driver.getPhoneNumber({ code: 'X' }), 'MINIPROGRAM_INVALID_RESPONSE');
  });
});

describe('小程序真实驱动：小程序码', () => {
  it('成功时应返回图片字节与 MIME，并只提交已定义的参数', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(fakeResponse(PNG_MAGIC, 200, 'image/jpeg'));

    const image = await driver.createUnlimitedQrCode({ scene: 'a=1', page: 'pages/index/index' });

    expect(image.contentType).toBe('image/jpeg');
    expect(image.buffer.subarray(0, 4)).toEqual(PNG_MAGIC);

    const { url, body } = readRequest();
    expect(url).toContain('/wxa/getwxacodeunlimit');
    expect(body).toEqual({ scene: 'a=1', page: 'pages/index/index' });
  });

  it('传入的可选参数应以官方蛇形字段名提交', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(fakeResponse(PNG_MAGIC, 200, 'image/png'));

    await driver.createUnlimitedQrCode({
      scene: 'a=1',
      checkPath: false,
      envVersion: 'trial',
      width: 430,
      isHyaline: true,
      lineColor: { r: 1, g: 2, b: 3 },
      autoColor: false,
    });

    expect(readRequest().body).toEqual({
      scene: 'a=1',
      check_path: false,
      env_version: 'trial',
      width: 430,
      is_hyaline: true,
      line_color: { r: 1, g: 2, b: 3 },
      auto_color: false,
    });
  });

  it('失败返回 JSON 时应按 errcode 转译，而非把错误 JSON 当成图片', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 41030, errmsg: 'invalid page' }));

    const error = await expectRejection(
      driver.createUnlimitedQrCode({ scene: 'a=1', page: 'pages/index/index' }),
      '41030',
    );
    expect(error.getStatus()).toBe(404);
  });

  it('Content-Type 被网关改写但应答为 JSON 错误时仍应正确识别', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(fakeResponse('{"errcode":40001,"errmsg":"invalid credential"}', 200, 'text/plain'));

    const error = await expectRejection(driver.createUnlimitedQrCode({ scene: 'a=1' }), '40001');
    expect(error.refreshTokenRetryable).toBe(true);
  });

  it('成功但应答体为空时应按异常上报', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(fakeResponse(Buffer.alloc(0), 200, 'image/jpeg'));

    await expectRejection(driver.createUnlimitedQrCode({ scene: 'a=1' }), 'MINIPROGRAM_BINARY_ERROR');
  });

  it('小程序码与小程序二维码应提交各自的官方参数集合', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(fakeResponse(PNG_MAGIC, 200, 'image/jpeg'));
    await driver.createQrCode({ path: 'pages/index/index', width: 300 });
    expect(readRequest(0).url).toContain('/wxa/getwxacode');
    expect(readRequest(0).body).toEqual({ path: 'pages/index/index', width: 300 });

    fetchMock.mockResolvedValueOnce(fakeResponse(PNG_MAGIC, 200, 'image/jpeg'));
    await driver.createPlainQrCode({ path: 'pages/index/index' });
    expect(readRequest(1).url).toContain('/cgi-bin/wxaapp/createwxaqrcode');
    expect(readRequest(1).body).toEqual({ path: 'pages/index/index' });
  });

  it('参数越界应在发起请求前被拦截', async () => {
    await expectRejection(driver.createUnlimitedQrCode({ scene: 'a=1', width: 100 }), 'MINIPROGRAM_QR_WIDTH_INVALID');
    await expectRejection(driver.createUnlimitedQrCode({ scene: '订单' }), 'MINIPROGRAM_QR_SCENE_INVALID');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('小程序真实驱动：内容安全', () => {
  it('应归一化 suggest / label，并提供 pass 便捷判定', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        errcode: 0,
        errmsg: 'ok',
        trace_id: 'trace-1',
        result: { suggest: 'risky', label: 20002 },
        detail: [{ strategy: 'content_model', suggest: 'risky', label: 20002, prob: 90 }],
      }),
    );

    const result = await driver.checkText({ content: '违规内容', scene: 2, openid: 'o1' });

    expect(result.pass).toBe(false);
    expect(result.suggest).toBe('risky');
    expect(result.labelDescription).toBe('色情');
    expect(result.traceId).toBe('trace-1');
    expect(result.detail).toHaveLength(1);

    const { url, body } = readRequest();
    expect(url).toContain('/wxa/msg_sec_check');
    expect(body).toEqual({ content: '违规内容', version: 2, scene: 2, openid: 'o1' });
  });

  it('正常内容应给出 pass 与正常标签', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errcode: 0, errmsg: 'ok', result: { suggest: 'pass', label: 100 } }),
    );

    const result = await driver.checkText({ content: '你好', scene: 1, openid: 'o1' });

    expect(result.pass).toBe(true);
    expect(result.labelDescription).toBe('正常');
    expect(result.detail).toEqual([]);
  });

  it('应答缺少可判定的 suggest 时应按失败处理，避免绕过审核', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await expectRejection(driver.checkText({ content: 'hi', scene: 1, openid: 'o1' }), 'MINIPROGRAM_INVALID_RESPONSE');
  });
});

describe('小程序真实驱动：订阅消息', () => {
  it('应补齐默认的 miniprogram_state 与 lang', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await driver.sendSubscribeMessage({
      touser: 'o1',
      templateId: 'TPL',
      data: { phrase3: { value: '审核通过' } },
    });

    const { url, body } = readRequest();
    expect(url).toContain('/cgi-bin/message/subscribe/send');
    expect(body).toEqual({
      touser: 'o1',
      template_id: 'TPL',
      data: { phrase3: { value: '审核通过' } },
      miniprogram_state: 'formal',
      lang: 'zh_CN',
    });
  });

  it('用户未订阅（43101）应转译为 409，便于调用方分支处理', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 43101, errmsg: 'user refuse to accept the msg' }));

    const error = await expectRejection(
      driver.sendSubscribeMessage({ touser: 'o1', templateId: 'TPL', data: { a: { value: 'b' } } }),
      '43101',
    );
    expect(error.getStatus()).toBe(409);
    expect(error.category).toBe('business-state');
  });

  it('属写操作，即使遇到可重试错误也不得重试', async () => {
    await primeToken();
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: -1, errmsg: 'system error' }));

    await expectRejection(
      driver.sendSubscribeMessage({ touser: 'o1', templateId: 'T', data: { a: { value: 'b' } } }),
      '-1',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('小程序真实驱动：容错与可重试性', () => {
  it('幂等安全的读类操作遇系统繁忙应自动重试', async () => {
    await primeToken();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ errcode: -1, errmsg: 'system error' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await expect(driver.checkSessionKey('o1', 'sk')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('一次性凭证类接口（code2Session）遇系统繁忙不得重试', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: -1, errmsg: 'system error' }));

    await expectRejection(driver.code2Session('JS_CODE'), '-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('凭证失效（42001）应强制刷新 access_token 后重试一次', async () => {
    await primeToken();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ errcode: 42001, errmsg: 'access_token expired' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'REFRESHED_TOKEN', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

    await expect(driver.checkSessionKey('o1', 'sk')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(readRequest(1).body).toMatchObject({ force_refresh: true });
    expect(readRequest(2).url).toContain('access_token=REFRESHED_TOKEN');
  });

  it('刷新凭证失败时应保留原始业务错误，便于定位真因', async () => {
    await primeToken();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ errcode: 42001, errmsg: 'access_token expired' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 40164, errmsg: 'invalid ip not in whitelist' }));

    await expectRejection(driver.checkSessionKey('o1', 'sk'), '42001');
  });

  it('请求超时应转译为 504', async () => {
    fetchMock.mockImplementation(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });

    const error = await expectRejection(driver.code2Session('JS_CODE'), 'MINIPROGRAM_TIMEOUT');
    expect(error.getStatus()).toBe(504);
  });

  it('网络异常应转译为 502', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const error = await expectRejection(driver.code2Session('JS_CODE'), 'MINIPROGRAM_NETWORK_ERROR');
    expect(error.getStatus()).toBe(502);
  });

  it('网关返回非 JSON 错误页时应按 HTTP 状态转译', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse('<html>502 Bad Gateway</html>', 502, 'text/html'));

    const error = await expectRejection(driver.code2Session('JS_CODE'), 'MINIPROGRAM_HTTP_ERROR');
    expect(error.getStatus()).toBe(502);
  });
});

describe('小程序真实驱动：运维', () => {
  it('健康检查应仅做本地校验，不发起外部请求', () => {
    expect(driver.checkHealth()).toMatchObject({ status: 'up', driver: 'real', configured: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('凭证缺失时健康状态应降级', () => {
    const unconfigured = new RealMiniprogramDriver({
      appid: '',
      appSecret: '',
      logger: createSilentLogger(),
    });

    expect(unconfigured.checkHealth()).toMatchObject({ status: 'degraded', configured: false });
  });
});
