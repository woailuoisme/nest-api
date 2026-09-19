import type { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockMiniprogramDriver } from '@/common/wechat/miniprogram/drivers/mock.driver';
import { MiniprogramException } from '@/common/wechat/miniprogram/miniprogram.exception';

const APP_ID = 'mock-miniprogram-appid';
/** PNG 魔数：验证 mock 产出的确实是图像字节而非 JSON */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** 静默 Logger：避免用例输出被驱动的日志刷屏 */
function createSilentLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
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

let driver: MockMiniprogramDriver;

beforeEach(() => {
  driver = new MockMiniprogramDriver({ appid: APP_ID, logger: createSilentLogger() });
});

describe('小程序 mock 驱动：接口调用凭据', () => {
  it('凭证应由 appid 确定性派生，重复获取结果一致', async () => {
    const first = await driver.getAccessToken();

    expect(first).toBe(await driver.getAccessToken());
    expect(first).toBe(await driver.refreshAccessToken());
    expect(first).toContain(APP_ID);
  });
});

describe('小程序 mock 驱动：登录', () => {
  it('同一 jsCode 应派生出可复现的 openid 与 session_key', async () => {
    const first = await driver.code2Session('JS_CODE');
    const second = await driver.code2Session('JS_CODE');

    expect(first).toEqual(second);
    expect(first.openid).toMatch(/^mock-openid-[0-9a-f]{28}$/);
    // session_key 为 16 字节密钥的 base64 形态，与官方一致
    expect(Buffer.from(first.sessionKey, 'base64')).toHaveLength(16);
  });

  it('不同 jsCode 应派生出不同用户', async () => {
    const first = await driver.code2Session('JS_CODE_A');
    const second = await driver.code2Session('JS_CODE_B');

    expect(first.openid).not.toBe(second.openid);
  });

  it('登录后登录态校验应通过，密钥不匹配或用户未知时应返回 false', async () => {
    const session = await driver.code2Session('JS_CODE');

    await expect(driver.checkSessionKey(session.openid, session.sessionKey)).resolves.toBe(true);
    await expect(driver.checkSessionKey(session.openid, 'wrong-key')).resolves.toBe(false);
    await expect(driver.checkSessionKey('unknown-openid', session.sessionKey)).resolves.toBe(false);
  });

  it('重置登录态应轮换密钥，旧密钥立即失效', async () => {
    const session = await driver.code2Session('JS_CODE');

    const reset = await driver.resetUserSessionKey(session.openid, session.sessionKey);

    expect(reset.openid).toBe(session.openid);
    expect(reset.sessionKey).not.toBe(session.sessionKey);

    await expect(driver.checkSessionKey(session.openid, session.sessionKey)).resolves.toBe(false);
    await expect(driver.checkSessionKey(session.openid, reset.sessionKey)).resolves.toBe(true);
  });

  it('使用无效登录态重置应报 87007，与真实驱动错误码语义一致', async () => {
    const session = await driver.code2Session('JS_CODE');

    await expectRejection(driver.resetUserSessionKey(session.openid, 'wrong-key'), '87007');
  });
});

describe('小程序 mock 驱动：手机号', () => {
  it('应由 code 派生出确定性的 11 位手机号', async () => {
    const first = await driver.getPhoneNumber({ code: 'PHONE_CODE' });
    const second = await driver.getPhoneNumber({ code: 'PHONE_CODE' });

    expect(first.phoneNumber).toBe(second.phoneNumber);
    expect(first.purePhoneNumber).toBe(second.purePhoneNumber);
    expect(first.purePhoneNumber).toMatch(/^1[3-9]\d{9}$/);
    expect(first.phoneNumber).toBe(`86${first.purePhoneNumber}`);
    expect(first.countryCode).toBe('86');
    expect(first.watermark?.appid).toBe(APP_ID);
  });

  it('不同 code 应派生出不同手机号', async () => {
    const first = await driver.getPhoneNumber({ code: 'CODE_A' });
    const second = await driver.getPhoneNumber({ code: 'CODE_B' });

    expect(first.purePhoneNumber).not.toBe(second.purePhoneNumber);
  });
});

describe('小程序 mock 驱动：小程序码', () => {
  it('应返回结构合法的 PNG 字节与图片 MIME', async () => {
    const image = await driver.createUnlimitedQrCode({ scene: 'a=1' });

    expect(image.contentType).toBe('image/png');
    expect(image.buffer.subarray(0, 4)).toEqual(PNG_MAGIC);
    expect(image.buffer.length).toBeGreaterThan(0);
  });

  it('每次返回独立副本，避免调用方修改影响后续调用', async () => {
    const first = await driver.createUnlimitedQrCode({ scene: 'a=1' });
    first.buffer[0] = 0x00;

    const second = await driver.createUnlimitedQrCode({ scene: 'a=1' });
    expect(second.buffer.subarray(0, 4)).toEqual(PNG_MAGIC);
  });

  it('三种码接口均应通过同一套入参校验', async () => {
    await expectRejection(driver.createUnlimitedQrCode({ scene: '' }), 'MINIPROGRAM_QR_SCENE_MISSING');
    await expectRejection(driver.createUnlimitedQrCode({ scene: 'a'.repeat(33) }), 'MINIPROGRAM_QR_SCENE_TOO_LONG');
    await expectRejection(
      driver.createUnlimitedQrCode({ scene: 'a=1', page: '/pages/index/index' }),
      'MINIPROGRAM_QR_PATH_INVALID',
    );
    await expectRejection(driver.createQrCode({ path: '' }), 'MINIPROGRAM_QR_PATH_MISSING');
    await expectRejection(
      driver.createPlainQrCode({ path: 'pages/index/index', width: 9999 }),
      'MINIPROGRAM_QR_WIDTH_INVALID',
    );
  });

  it('三类小程序码应均可生成', async () => {
    await expect(driver.createUnlimitedQrCode({ scene: 'a=1', page: 'pages/index/index' })).resolves.toBeTruthy();
    await expect(driver.createQrCode({ path: 'pages/index/index' })).resolves.toBeTruthy();
    await expect(driver.createPlainQrCode({ path: 'pages/index/index' })).resolves.toBeTruthy();
  });
});

describe('小程序 mock 驱动：内容安全', () => {
  it('普通内容应判定为通过', async () => {
    const result = await driver.checkText({ content: '今天天气不错', scene: 2, openid: 'o1' });

    expect(result.pass).toBe(true);
    expect(result.suggest).toBe('pass');
    expect(result.label).toBe(100);
    expect(result.traceId).toMatch(/^mock-trace-[0-9a-f]{16}$/);
  });

  it('命中违规关键词应判定为 risky 且 pass 为 false', async () => {
    const result = await driver.checkText({ content: '这段内容包含违规词', scene: 2, openid: 'o1' });

    expect(result.pass).toBe(false);
    expect(result.suggest).toBe('risky');
    expect(result.detail[0]).toMatchObject({ strategy: 'mock_rule', suggest: 'risky' });
  });

  it('命中待审关键词应判定为 review', async () => {
    const result = await driver.checkText({ content: '请 review 一下', scene: 1, openid: 'o1' });

    expect(result.suggest).toBe('review');
    expect(result.pass).toBe(false);
  });

  it('入参校验与真实驱动一致', async () => {
    await expectRejection(driver.checkText({ content: '', scene: 1, openid: 'o1' }), 'MINIPROGRAM_CONTENT_MISSING');
    await expectRejection(
      driver.checkText({ content: '字'.repeat(2501), scene: 1, openid: 'o1' }),
      'MINIPROGRAM_CONTENT_TOO_LONG',
    );
  });
});

describe('小程序 mock 驱动：订阅消息', () => {
  it('合法入参应发送成功', async () => {
    await expect(
      driver.sendSubscribeMessage({ touser: 'o1', templateId: 'TPL', data: { phrase3: { value: '通过' } } }),
    ).resolves.toBeUndefined();
  });

  it('缺参应在发送前被拦截', async () => {
    await expectRejection(
      driver.sendSubscribeMessage({ touser: '', templateId: 'TPL', data: { a: { value: 'b' } } }),
      'MINIPROGRAM_SUBSCRIBE_INPUT_INVALID',
    );
  });
});

describe('小程序 mock 驱动：运维', () => {
  it('健康状态应可用但明确标记为未配置真实凭证', () => {
    expect(driver.checkHealth()).toMatchObject({ status: 'up', driver: 'mock', configured: false });
  });
});
