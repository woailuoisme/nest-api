/**
 * Basic Auth 共享校验工具单元测试
 *
 * 覆盖：合法凭据、密码含冒号、缺失/畸形请求头、时序安全比较
 */
import { describe, expect, it } from 'vitest';

import { matchesBasicAuth, safeEqual } from '@/common/utils/basic-auth.util';

/** 构造 Basic Authorization 头 */
const basic = (user: string, pass: string): string => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('matchesBasicAuth()', () => {
  it('合法凭据应通过校验', () => {
    expect(matchesBasicAuth(basic('admin', 'secret'), 'admin', 'secret')).toBe(true);
  });

  it('密码包含冒号时应完整比对（按首个冒号分割）', () => {
    expect(matchesBasicAuth(basic('admin', 'se:cret:123'), 'admin', 'se:cret:123')).toBe(true);
    expect(matchesBasicAuth(basic('admin', 'se'), 'admin', 'se:cret:123')).toBe(false);
  });

  it('用户名或密码错误应拒绝', () => {
    expect(matchesBasicAuth(basic('admin', 'wrong'), 'admin', 'secret')).toBe(false);
    expect(matchesBasicAuth(basic('hacker', 'secret'), 'admin', 'secret')).toBe(false);
  });

  it('缺失 Authorization 头应拒绝', () => {
    expect(matchesBasicAuth(undefined, 'admin', 'secret')).toBe(false);
  });

  it('非 Basic 方案应拒绝', () => {
    expect(matchesBasicAuth(`Bearer token123`, 'admin', 'secret')).toBe(false);
  });

  it('scheme 大小写不敏感', () => {
    expect(matchesBasicAuth(`bAsIc ${Buffer.from('admin:secret').toString('base64')}`, 'admin', 'secret')).toBe(true);
  });

  it('编码段缺失冒号应拒绝', () => {
    expect(matchesBasicAuth(`Basic ${Buffer.from('adminsecret').toString('base64')}`, 'admin', 'secret')).toBe(false);
  });

  it('空编码段应拒绝', () => {
    expect(matchesBasicAuth('Basic ', 'admin', 'secret')).toBe(false);
  });
});

describe('safeEqual()', () => {
  it('相同字符串应返回 true', () => {
    expect(safeEqual('same-value', 'same-value')).toBe(true);
  });

  it('不同字符串应返回 false', () => {
    expect(safeEqual('a', 'b')).toBe(false);
    expect(safeEqual('short', 'much-longer-value')).toBe(false);
  });

  it('空字符串之间应相等', () => {
    expect(safeEqual('', '')).toBe(true);
  });
});
