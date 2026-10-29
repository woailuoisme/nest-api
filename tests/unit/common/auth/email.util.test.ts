import { describe, expect, it } from 'vitest';

import { normalizeEmail } from '@/common/auth/email.util';

describe('normalizeEmail', () => {
  it('应去除首尾空白并统一小写', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('应做 NFC 归一化（同一邮箱的不同 Unicode 表示必须等价）', () => {
    const composed = 'jos\u00e9@example.com'; // é 单码点
    const decomposed = 'jose\u0301@example.com'; // e + 组合重音符

    expect(normalizeEmail(composed)).toBe(normalizeEmail(decomposed));
  });

  it('已是规范形式时保持幂等', () => {
    const value = normalizeEmail('ada@example.com');

    expect(normalizeEmail(value)).toBe(value);
  });
});
