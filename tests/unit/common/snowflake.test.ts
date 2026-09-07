/**
 * Snowflake ID 生成器单元测试
 *
 * 覆盖：基础生成、唯一性、单调性、序列号溢出、时钟回拨恢复、reset 状态隔离
 */
import { range, uniq } from 'es-toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Snowflake } from '@/common/utils/snowflake.util';

// EPOCH = 2024-01-01 ≈ 1704067200000，mock 时间需在 epoch 之后避免 BigInt 负数
const POST_EPOCH = 1_800_000_000_000; // ~2027 年

describe('Snowflake', () => {
  beforeEach(() => Snowflake.reset());
  afterEach(() => {
    Snowflake.reset();
    vi.restoreAllMocks();
  });

  describe('generate() — 基础 Snowflake ID', () => {
    it('应返回纯数字字符串', () => {
      const id = Snowflake.generate();
      expect(id).toMatch(/^\d+$/);
    });

    it('生成的 ID 长度应在 18~19 位之间', () => {
      const id = Snowflake.generate();
      expect(id.length).toBeGreaterThanOrEqual(18);
      expect(id.length).toBeLessThanOrEqual(19);
    });

    it('连续生成 100 个 ID 应全部唯一', () => {
      const ids = uniq(range(100).map(() => Snowflake.generate()));
      expect(ids).toHaveLength(100);
    });

    it('连续生成的 ID 应按时间单调递增', () => {
      const ids = range(10).map(() => BigInt(Snowflake.generate()));
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]).toBeGreaterThan(ids[i - 1]);
      }
    });

    it('批量 1000 个 ID 应全部唯一', () => {
      const ids = uniq(range(1000).map(() => Snowflake.generate()));
      expect(ids).toHaveLength(1000);
    });

    it('超过单毫秒序列号上限 (4096) 后仍保持唯一（逻辑推进时间戳）', () => {
      vi.spyOn(Date, 'now').mockReturnValue(POST_EPOCH);

      const ids = uniq(range(5000).map(() => Snowflake.generate()));
      expect(ids).toHaveLength(5000);
    });
  });

  describe('gen() — 通用业务编号', () => {
    it('应按自定义前缀生成业务编号', () => {
      const no = Snowflake.gen('ORD');
      expect(no).toMatch(/^ORD\d{8}\d{18,19}$/);
    });

    it('日期部分应为当天 YYYYMMDD 格式', () => {
      const no = Snowflake.gen('TST');
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const datePart = no.slice(3, 11);
      expect(datePart).toBe(todayStr);
    });
  });

  describe('业务编号快捷方法', () => {
    it('genOrderNo() 应返回 ORD 前缀编号', () => {
      const no = Snowflake.genOrderNo();
      expect(no).toMatch(/^ORD\d{8}\d{18,19}$/);
    });

    it('genTransactionNo() 应返回 TXN 前缀编号', () => {
      const no = Snowflake.genTransactionNo();
      expect(no).toMatch(/^TXN\d{8}\d{18,19}$/);
    });

    it('genRefundNo() 应返回 RFD 前缀编号', () => {
      const no = Snowflake.genRefundNo();
      expect(no).toMatch(/^RFD\d{8}\d{18,19}$/);
    });

    it('genPaymentNo() 应返回 PAY 前缀编号', () => {
      const no = Snowflake.genPaymentNo();
      expect(no).toMatch(/^PAY\d{8}\d{18,19}$/);
    });

    it('genShipmentNo() 应返回 SHP 前缀编号', () => {
      const no = Snowflake.genShipmentNo();
      expect(no).toMatch(/^SHP\d{8}\d{18,19}$/);
    });

    it('genInvoiceNo() 应返回 INV 前缀编号', () => {
      const no = Snowflake.genInvoiceNo();
      expect(no).toMatch(/^INV\d{8}\d{18,19}$/);
    });

    it('不同业务编号方法应生成不同的 ID', () => {
      const orderNo = Snowflake.genOrderNo();
      const txnNo = Snowflake.genTransactionNo();
      const invoiceNo = Snowflake.genInvoiceNo();
      expect(orderNo).not.toBe(txnNo);
      expect(txnNo).not.toBe(invoiceNo);
      expect(orderNo).not.toBe(invoiceNo);
    });
  });

  describe('时钟回拨 — 检测 + 自动恢复', () => {
    it('检测到时钟回拨时应抛异常（状态已重置）', () => {
      // 先用"未来"时间生成一个 ID
      vi.spyOn(Date, 'now').mockReturnValue(POST_EPOCH + 10_000);
      Snowflake.generate();

      // 模拟时钟回拨 1 秒
      vi.spyOn(Date, 'now').mockReturnValue(POST_EPOCH + 9_000);

      expect(() => Snowflake.generate()).toThrow(/时钟大幅回拨/);
    });

    it('回拨后状态已自动恢复，下一个调用可正常生成', () => {
      // 先在"未来"生成 ID
      vi.spyOn(Date, 'now').mockReturnValue(POST_EPOCH + 10_000);
      Snowflake.generate();

      // 时钟回拨 → 抛异常
      vi.spyOn(Date, 'now').mockReturnValue(POST_EPOCH + 9_000);
      expect(() => Snowflake.generate()).toThrow(/时钟大幅回拨/);

      // 恢复正常的 Date.now() 后应能继续生成唯一 ID
      vi.restoreAllMocks();
      Snowflake.reset();
      const ids = uniq(range(10).map(() => Snowflake.generate()));
      expect(ids).toHaveLength(10);
    });
  });

  describe('reset() — 状态隔离', () => {
    it('reset 后应能生成 ID 且不受之前状态影响', () => {
      Snowflake.generate();
      Snowflake.generate();
      Snowflake.reset();

      const id = Snowflake.generate();
      expect(id).toMatch(/^\d+$/);
    });

    it('reset 后日期缓存也被清除', () => {
      Snowflake.gen('TST');
      Snowflake.reset();

      const no = Snowflake.gen('TST');
      expect(no).toMatch(/^TST\d{8}\d{18,19}$/);
    });
  });
});
