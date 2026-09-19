import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  getMiniprogramErrorCategory,
  isMiniprogramError,
  isMiniprogramRetryable,
  MiniprogramException,
  resolveMiniprogramErrorStatus,
} from '@/common/wechat/miniprogram/miniprogram.exception';

describe('小程序错误码到 HTTP 状态的映射', () => {
  it.each([
    ['-1', HttpStatus.BAD_GATEWAY],
    ['40001', HttpStatus.UNAUTHORIZED],
    ['40003', HttpStatus.BAD_REQUEST],
    ['40013', HttpStatus.UNAUTHORIZED],
    ['40029', HttpStatus.BAD_REQUEST],
    ['40097', HttpStatus.BAD_REQUEST],
    ['40164', HttpStatus.FORBIDDEN],
    ['40226', HttpStatus.FORBIDDEN],
    ['41030', HttpStatus.NOT_FOUND],
    ['42001', HttpStatus.UNAUTHORIZED],
    ['43101', HttpStatus.CONFLICT],
    ['45011', HttpStatus.TOO_MANY_REQUESTS],
    ['87007', HttpStatus.BAD_REQUEST],
    ['87009', HttpStatus.UNAUTHORIZED],
    ['87014', HttpStatus.BAD_REQUEST],
  ])('errcode %s 应映射为 HTTP %s', (code, status) => {
    expect(resolveMiniprogramErrorStatus(code)).toBe(status);
  });

  it('自定义配置类错误应映射为 500，而非被误判为上游故障', () => {
    expect(resolveMiniprogramErrorStatus('MINIPROGRAM_CONFIG_INCOMPLETE')).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(resolveMiniprogramErrorStatus('MINIPROGRAM_MOCK_ONLY')).toBe(HttpStatus.BAD_REQUEST);
  });

  it('未收录错误码应兜底为 502', () => {
    expect(resolveMiniprogramErrorStatus('999999')).toBe(HttpStatus.BAD_GATEWAY);
  });
});

describe('小程序错误的可重试性判定', () => {
  it('凭证失效类错误应标记为「刷新 token 后可重试」', () => {
    for (const code of ['40001', '40014', '41001', '42001']) {
      const error = new MiniprogramException(code, 'test');
      expect(error.refreshTokenRetryable).toBe(true);
    }
  });

  it('参数、权限、风控与业务状态类错误不得重试', () => {
    for (const code of ['40029', '40129', '40164', '40226', '41030', '43101', '87014']) {
      const error = new MiniprogramException(code, 'test');
      expect(error.refreshTokenRetryable).toBe(false);
      expect(error.plainRetryable).toBe(false);
      expect(isMiniprogramRetryable(error)).toBe(false);
    }
  });

  it('仅微信侧瞬态故障与频率限制可原样重试', () => {
    for (const code of ['-1', '45011', '44991']) {
      expect(isMiniprogramRetryable(new MiniprogramException(code, 'test'))).toBe(true);
    }
    expect(isMiniprogramRetryable(new MiniprogramException('45009', 'test'))).toBe(false);
  });

  it('非小程序领域异常不应被判定为可重试', () => {
    expect(isMiniprogramRetryable(new Error('boom'))).toBe(false);
    expect(isMiniprogramError(new Error('boom'))).toBe(false);
  });
});

describe('异常构造与错误分类', () => {
  it('fromApiError 应拼接官方描述与原始 errmsg，并保留官方错误码', () => {
    const error = MiniprogramException.fromApiError(42001, 'access_token expired');

    expect(error.miniprogramCode).toBe('42001');
    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(error.message).toMatch(/access_token 已过期/);
    expect(error.message).toMatch(/access_token expired/);
    expect(error.category).toBe('auth');
  });

  it('errcode 为字符串形态时应与数字形态等价', () => {
    expect(MiniprogramException.fromApiError('40029', 'invalid code').miniprogramCode).toBe('40029');
  });

  it('未收录 errcode 时应回退为通用文案而非丢失错误码', () => {
    const error = MiniprogramException.fromApiError(987654, 'unknown error');

    expect(error.miniprogramCode).toBe('987654');
    expect(error.message).toMatch(/unknown error/);
    expect(error.category).toBeUndefined();
  });

  it('fromRawError 应解析携带 errcode 的 JSON 应答', () => {
    const error = MiniprogramException.fromRawError('{"errcode":41030,"errmsg":"invalid page"}');

    expect(error.miniprogramCode).toBe('41030');
    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.category).toBe('not-found');
  });

  it('fromRawError 面对非 JSON 应答时应降级为二进制接口错误', () => {
    const error = MiniprogramException.fromRawError('<html>502 Bad Gateway</html>');

    expect(error.miniprogramCode).toBe('MINIPROGRAM_BINARY_ERROR');
    expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
  });

  it('fromRawError 面对 errcode 为 0 的 JSON 不应误判为业务错误', () => {
    const error = MiniprogramException.fromRawError('{"errcode":0,"errmsg":"ok"}');

    expect(error.miniprogramCode).toBe('MINIPROGRAM_BINARY_ERROR');
  });

  it('各分类应可通过 getMiniprogramErrorCategory 单独查询', () => {
    expect(getMiniprogramErrorCategory('48001')).toBe('permission');
    expect(getMiniprogramErrorCategory('43101')).toBe('business-state');
    expect(getMiniprogramErrorCategory('87014')).toBe('risk-control');
    expect(getMiniprogramErrorCategory('-1')).toBe('upstream');
  });
});
