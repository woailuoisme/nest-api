/**
 * OTP 验证码工具单元测试
 *
 * 覆盖：加密安全随机验证码生成
 */
import { range, uniq } from 'es-toolkit';
import { describe, expect, it } from 'vitest';

import { Otp } from '@/common/utils/otp.util';

describe('Otp', () => {
  describe('generate() — 随机验证码', () => {
    it('应返回 6 位数字字符串', () => {
      const code = Otp.generate();
      expect(code).toMatch(/^\d{6}$/);
    });

    it('应在 100000~999999 范围内', () => {
      for (let i = 0; i < 50; i++) {
        const code = Number(Otp.generate());
        expect(code).toBeGreaterThanOrEqual(100_000);
        expect(code).toBeLessThan(1_000_000);
      }
    });

    it('连续生成应具有随机性（非固定值）', () => {
      const codes = uniq(range(20).map(() => Otp.generate()));
      // 20 次生成中至少有 2 个不同值（概率极低的全相同情况可忽略）
      expect(codes.length).toBeGreaterThan(1);
    });
  });
});
