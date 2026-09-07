import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractTimestampFromUuidV7, isUuid, uuidv7 } from '@/common/utils/uuid.util';

describe('UUIDv7 Utility (RFC 9562)', () => {
  it('应生成合法的 36 字符 UUIDv7 格式字符串', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(isUuid(id)).toBe(true);
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

  it('从 UUIDv7 提取的生成时间戳应与当前时间接近', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();

    const timestamp = extractTimestampFromUuidV7(id);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it('同毫秒序列号溢出与时钟回拨时仍保持严格单调有序', () => {
    const realNow = Date.now;
    let fakeNow = realNow();
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    try {
      const ids: string[] = [];
      // 同一毫秒内 5000 次调用：触发 12 位序列号溢出进位
      for (let i = 0; i < 5000; i++) {
        ids.push(uuidv7());
      }
      // 模拟时钟回拨 5 秒：ID 不得回退
      fakeNow -= 5000;
      for (let i = 0; i < 100; i++) {
        ids.push(uuidv7());
      }
      // 时钟恢复前进
      fakeNow += 6000;
      for (let i = 0; i < 100; i++) {
        ids.push(uuidv7());
      }

      for (let i = 1; i < ids.length; i++) {
        expect(ids[i] > ids[i - 1]).toBe(true);
      }
    } finally {
      vi.restoreAllMocks();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isUuid 能够正确识别合法与非法 UUID', () => {
    expect(isUuid('018e69c1-7f89-7000-8000-000000000000')).toBe(true);
    expect(isUuid('c56a4180-65aa-42ec-a945-5fd21dec0538')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(12345)).toBe(false);
  });
});
