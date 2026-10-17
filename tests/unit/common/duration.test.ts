/**
 * 时长解析工具单元测试
 *
 * 覆盖：各单位换算、纯数字、大小写、非法输入
 */
import { describe, expect, it } from 'vitest';

import { parseDuration } from '@/common/utils/duration.util';

describe('parseDuration()', () => {
  it('毫秒单位 ms', () => {
    expect(parseDuration('500ms')).toBe(500);
  });

  it('秒单位 s', () => {
    expect(parseDuration('30s')).toBe(30_000);
  });

  it('分钟单位 m', () => {
    expect(parseDuration('15m')).toBe(900_000);
  });

  it('小时单位 h', () => {
    expect(parseDuration('2h')).toBe(7_200_000);
  });

  it('天单位 d', () => {
    expect(parseDuration('7d')).toBe(604_800_000);
  });

  it('周单位 w', () => {
    expect(parseDuration('1w')).toBe(604_800_000);
  });

  it('纯数字应按毫秒处理', () => {
    expect(parseDuration('1000')).toBe(1000);
  });

  it('0 应返回 0', () => {
    expect(parseDuration('0')).toBe(0);
  });

  it('单位大小写不敏感', () => {
    expect(parseDuration('15M')).toBe(900_000);
    expect(parseDuration('7D')).toBe(604_800_000);
  });

  it('前后空白应被忽略', () => {
    expect(parseDuration(' 15m ')).toBe(900_000);
  });

  it('非法格式应抛出错误', () => {
    expect(() => parseDuration('abc')).toThrow(/Invalid duration/);
  });

  it('空字符串应抛出错误', () => {
    expect(() => parseDuration('')).toThrow(/Invalid duration/);
  });

  it('负数应抛出错误', () => {
    expect(() => parseDuration('-1d')).toThrow(/Invalid duration/);
  });

  it('超出安全整数范围应抛出错误', () => {
    expect(() => parseDuration('999999999d')).toThrow(/safe integer/);
  });
});
