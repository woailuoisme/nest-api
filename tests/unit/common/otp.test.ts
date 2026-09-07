/**
 * OTP 验证码工具单元测试
 *
 * 覆盖：随机验证码生成、TOTP 密钥生成/验证码生成/验证
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

  describe('TOTP 模式', () => {
    it('generateTotpSecret() 应返回 Base32 格式密钥', () => {
      const secret = Otp.generateTotpSecret();
      expect(secret).toBeTruthy();
      expect(typeof secret).toBe('string');
      // Base32 字符集：A-Z 和 2-7
      expect(secret).toMatch(/^[A-Z2-7]+$/);
    });

    it('generateTotp() 应根据密钥生成 6 位验证码', async () => {
      const secret = Otp.generateTotpSecret();
      const token = await Otp.generateTotp(secret);
      expect(token).toMatch(/^\d{6}$/);
    });

    it('verifyTotp() 应验证当前生成的 TOTP 为有效', async () => {
      const secret = Otp.generateTotpSecret();
      const token = await Otp.generateTotp(secret);
      const valid = await Otp.verifyTotp(token, secret);
      expect(valid).toBe(true);
    });

    it('verifyTotp() 应拒绝错误的验证码', async () => {
      const secret = Otp.generateTotpSecret();
      const valid = await Otp.verifyTotp('000000', secret);
      expect(valid).toBe(false);
    });

    it('不同密钥生成的 TOTP 应不能互相验证', async () => {
      const secretA = Otp.generateTotpSecret();
      const secretB = Otp.generateTotpSecret();
      const tokenA = await Otp.generateTotp(secretA);
      const valid = await Otp.verifyTotp(tokenA, secretB);
      expect(valid).toBe(false);
    });
  });
});
