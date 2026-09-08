import { validate as isUuid, version as uuidVersion, v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';

describe('Official UUID Library Integration (RFC 9562 v7)', () => {
  it('应生成合法的 36 字符 UUIDv7 格式字符串并被 validate 识别', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(isUuid(id)).toBe(true);
    expect(uuidVersion(id)).toBe(7);
  });

  it('连续生成的 UUIDv7 应保持时间单调有序递增', () => {
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(uuidv7());
    }

    // 验证严格字典序单调递增
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] > ids[i - 1]).toBe(true);
    }
  });

  it('validate 能够正确识别合法与非法 UUID', () => {
    expect(isUuid('018e69c1-7f89-7000-8000-000000000000')).toBe(true);
    expect(isUuid('c56a4180-65aa-42ec-a945-5fd21dec0538')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});
