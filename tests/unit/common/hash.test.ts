/**
 * 哈希工具单元测试
 *
 * 覆盖：argon2id 密码哈希/验证、sha256 摘要
 */
import { describe, expect, it } from 'vitest';
import { Hash, sha256 } from '@/common/utils/hash.util';

describe('Hash', () => {
  describe('make() — 密码哈希', () => {
    it('应返回 argon2id 格式的哈希字符串', async () => {
      const hash = await Hash.make('MyP@ssw0rd!2024');
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('每次对相同明文应生成不同的哈希（随机盐）', async () => {
      const hash1 = await Hash.make('same-password');
      const hash2 = await Hash.make('same-password');
      expect(hash1).not.toBe(hash2);
    });

    it('空字符串也应能正常哈希', async () => {
      const hash = await Hash.make('');
      expect(hash).toMatch(/^\$argon2id\$/);
    });
  });

  describe('check() — 密码验证', () => {
    it('正确密码应返回 true', async () => {
      const password = 'correct-horse-battery-staple';
      const hash = await Hash.make(password);
      const result = await Hash.check(password, hash);
      expect(result).toBe(true);
    });

    it('错误密码应返回 false', async () => {
      const hash = await Hash.make('right-password');
      const result = await Hash.check('wrong-password', hash);
      expect(result).toBe(false);
    });

    it('大小写敏感 — 不同大小写应视为不匹配', async () => {
      const hash = await Hash.make('Password123');
      const result = await Hash.check('password123', hash);
      expect(result).toBe(false);
    });

    it('空字符串与空字符串应匹配', async () => {
      const hash = await Hash.make('');
      const result = await Hash.check('', hash);
      expect(result).toBe(true);
    });

    it('空白字符应视为不同密码', async () => {
      const hash = await Hash.make('abc');
      const result = await Hash.check('abc ', hash);
      expect(result).toBe(false);
    });
  });
});

describe('sha256', () => {
  it('应返回 64 位十六进制字符串', () => {
    const hash = sha256('hello');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('相同输入应产生相同输出（确定性）', () => {
    const h1 = sha256('deterministic-test');
    const h2 = sha256('deterministic-test');
    expect(h1).toBe(h2);
  });

  it('不同输入应产生不同输出', () => {
    const h1 = sha256('alpha');
    const h2 = sha256('beta');
    expect(h1).not.toBe(h2);
  });

  it('空字符串应有确定的哈希值', () => {
    const hash = sha256('');
    // SHA-256 空字符串的已知结果
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
