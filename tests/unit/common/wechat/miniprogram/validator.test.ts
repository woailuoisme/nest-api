import { describe, expect, it } from 'vitest';
import { MiniprogramException } from '@/common/wechat/miniprogram/miniprogram.exception';
import {
  assertJsCode,
  assertMsgSecCheckInput,
  assertPlainQrCodeInput,
  assertQrCodeInput,
  assertQrWidth,
  assertSessionKeyInput,
  assertSubscribeMessageInput,
  assertUnlimitedQrCodeInput,
} from '@/common/wechat/miniprogram/miniprogram.validator';

/** 期望抛出指定错误码的小程序领域异常 */
function expectCode(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(MiniprogramException);
  expect((caught as MiniprogramException).miniprogramCode).toBe(code);
}

describe('小程序入参校验', () => {
  it('jsCode 缺失应快速失败，避免无谓的网络往返', () => {
    expectCode(() => assertJsCode(''), 'MINIPROGRAM_JS_CODE_MISSING');
    expectCode(() => assertJsCode(undefined), 'MINIPROGRAM_JS_CODE_MISSING');
    expect(() => assertJsCode('js-code')).not.toThrow();
  });

  it('openid 与 session_key 缺失应分别给出可定位的错误码', () => {
    expectCode(() => assertSessionKeyInput('', 'key'), 'MINIPROGRAM_OPENID_MISSING');
    expectCode(() => assertSessionKeyInput('openid', ''), 'MINIPROGRAM_SESSION_KEY_MISSING');
    expect(() => assertSessionKeyInput('openid', 'key')).not.toThrow();
  });

  it('小程序码宽度应限制在官方 280~1280 区间内', () => {
    expectCode(() => assertQrWidth(279), 'MINIPROGRAM_QR_WIDTH_INVALID');
    expectCode(() => assertQrWidth(1281), 'MINIPROGRAM_QR_WIDTH_INVALID');
    expectCode(() => assertQrWidth(430.5), 'MINIPROGRAM_QR_WIDTH_INVALID');
    expect(() => assertQrWidth(280)).not.toThrow();
    expect(() => assertQrWidth(1280)).not.toThrow();
    expect(() => assertQrWidth(undefined)).not.toThrow();
  });

  it('不限制小程序码的 scene 必填、限长且校验字符集', () => {
    expectCode(() => assertUnlimitedQrCodeInput({ scene: '' }), 'MINIPROGRAM_QR_SCENE_MISSING');
    expectCode(() => assertUnlimitedQrCodeInput({ scene: 'a'.repeat(33) }), 'MINIPROGRAM_QR_SCENE_TOO_LONG');
    expectCode(() => assertUnlimitedQrCodeInput({ scene: '订单=1' }), 'MINIPROGRAM_QR_SCENE_INVALID');
    expectCode(() => assertUnlimitedQrCodeInput({ scene: 'a=1%20b' }), 'MINIPROGRAM_QR_SCENE_INVALID');

    expect(() => assertUnlimitedQrCodeInput({ scene: 'a'.repeat(32) })).not.toThrow();
    expect(() => assertUnlimitedQrCodeInput({ scene: "a=1&b=2-x_y.z~w!*'()" })).not.toThrow();
  });

  it('page 路径不得以 / 开头、不得携带参数、不得超长', () => {
    expectCode(
      () => assertUnlimitedQrCodeInput({ scene: 'a=1', page: '/pages/index/index' }),
      'MINIPROGRAM_QR_PATH_INVALID',
    );
    expectCode(
      () => assertUnlimitedQrCodeInput({ scene: 'a=1', page: 'pages/index/index?id=1' }),
      'MINIPROGRAM_QR_PATH_INVALID',
    );
    expectCode(
      () => assertUnlimitedQrCodeInput({ scene: 'a=1', page: `pages/${'a'.repeat(130)}` }),
      'MINIPROGRAM_QR_PATH_INVALID',
    );

    expect(() => assertUnlimitedQrCodeInput({ scene: 'a=1', page: 'pages/index/index' })).not.toThrow();
  });

  it('path 长度按 UTF-8 字节计算而非字符数', () => {
    // 40 个中文字符 = 120 字节，未超 128 字节上限
    const path = '页'.repeat(40);
    expect(() => assertQrCodeInput({ path })).not.toThrow();

    // 42 个中文字符 = 126 字节，仍未超；44 个则为 132 字节，超限
    expectCode(() => assertQrCodeInput({ path: '页'.repeat(44) }), 'MINIPROGRAM_QR_PATH_INVALID');
  });

  it('小程序码与小程序二维码均要求 path 必填', () => {
    expectCode(() => assertQrCodeInput({ path: '' }), 'MINIPROGRAM_QR_PATH_MISSING');
    expectCode(() => assertPlainQrCodeInput({ path: '' }), 'MINIPROGRAM_QR_PATH_MISSING');
  });

  it('内容安全文本必填且不超过 2500 字（按码点计数）', () => {
    expectCode(() => assertMsgSecCheckInput({ content: '', scene: 1, openid: 'o' }), 'MINIPROGRAM_CONTENT_MISSING');
    expectCode(
      () => assertMsgSecCheckInput({ content: '字'.repeat(2501), scene: 1, openid: 'o' }),
      'MINIPROGRAM_CONTENT_TOO_LONG',
    );

    expect(() => assertMsgSecCheckInput({ content: '字'.repeat(2500), scene: 1, openid: 'o' })).not.toThrow();
  });

  it('订阅消息的 touser / templateId / data 均为必填', () => {
    const data = { phrase3: { value: '审核通过' } };

    expectCode(
      () => assertSubscribeMessageInput({ touser: '', templateId: 't', data }),
      'MINIPROGRAM_SUBSCRIBE_INPUT_INVALID',
    );
    expectCode(
      () => assertSubscribeMessageInput({ touser: 'o', templateId: '', data }),
      'MINIPROGRAM_SUBSCRIBE_INPUT_INVALID',
    );
    expectCode(
      () => assertSubscribeMessageInput({ touser: 'o', templateId: 't', data: {} }),
      'MINIPROGRAM_SUBSCRIBE_INPUT_INVALID',
    );
    expect(() => assertSubscribeMessageInput({ touser: 'o', templateId: 't', data })).not.toThrow();
  });
});
