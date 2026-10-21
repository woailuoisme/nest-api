/**
 * FastifyAdapter trustProxy 解析规则单元测试
 *
 * 背景：`req.ip` 是限流与幂等作用域的输入，信任策略错配会让客户端通过伪造
 * `X-Forwarded-For` 绕过按 IP 限流。因此：
 * - 默认不信任；
 * - 生产环境禁止 `true`（Fastify 语义 = 信任全部跳数）；
 * - 不支持的按跳数写法必须启动即报错，而不是把非法值传给 proxy-addr 后在运行期崩溃。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveTrustProxy } from '@/setup/adapter';

describe('resolveTrustProxy (反向代理信任策略解析)', () => {
  const originalAppEnv = process.env.APP_ENV;

  beforeEach(() => {
    delete process.env.APP_ENV;
  });

  afterEach(() => {
    if (originalAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = originalAppEnv;
    }
  });

  it('未配置或显式 false 时默认不信任', () => {
    expect(resolveTrustProxy(undefined)).toBe(false);
    expect(resolveTrustProxy('')).toBe(false);
    expect(resolveTrustProxy('   ')).toBe(false);
    expect(resolveTrustProxy('false')).toBe(false);
    expect(resolveTrustProxy('FALSE')).toBe(false);
  });

  it('单个 CIDR / 地址返回字符串', () => {
    expect(resolveTrustProxy('172.16.0.0/12')).toBe('172.16.0.0/12');
    expect(resolveTrustProxy(' 10.0.0.1 ')).toBe('10.0.0.1');
  });

  it('多个 CIDR 返回字符串数组（Fastify 支持 list 形态）', () => {
    expect(resolveTrustProxy('10.0.0.0/8, 172.16.0.0/12')).toEqual(['10.0.0.0/8', '172.16.0.0/12']);
  });

  it('非生产环境允许 true（本地直连调试）', () => {
    process.env.APP_ENV = 'local';
    expect(resolveTrustProxy('true')).toBe(true);
    expect(resolveTrustProxy('1')).toBe(true);
  });

  it('生产环境使用 true 时拒绝启动（等价于信任任意 X-Forwarded-For）', () => {
    process.env.APP_ENV = 'production';
    expect(() => resolveTrustProxy('true')).toThrow(/TRUST_PROXY=true/);
    expect(() => resolveTrustProxy('yes')).toThrow(/TRUST_PROXY=true/);
    expect(() => resolveTrustProxy('1')).toThrow(/TRUST_PROXY=true/);
  });

  it('按跳数配置直接报错，而不是把非法值传给 proxy-addr', () => {
    expect(() => resolveTrustProxy('2')).toThrow(/按跳数/);
  });

  it('生产环境拒绝全通配 CIDR（等价于 true）', () => {
    process.env.APP_ENV = 'production';
    expect(() => resolveTrustProxy('0.0.0.0/0')).toThrow(/等价于信任任意来源/);
    expect(() => resolveTrustProxy('10.0.0.0/8,::/0')).toThrow(/等价于信任任意来源/);
  });

  it('非生产环境允许全通配 CIDR（本地直连调试）', () => {
    process.env.APP_ENV = 'local';
    expect(resolveTrustProxy('0.0.0.0/0')).toBe('0.0.0.0/0');
  });
});
