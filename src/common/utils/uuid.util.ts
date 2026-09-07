import { getRandomValues } from 'node:crypto';

let lastTimestamp = -1;
let seq = 0;

/** 生成 12 位随机序列号种子（与 62 位随机位一致，统一使用 CSPRNG） */
function randomSeq(): number {
  const buf = new Uint8Array(2);
  getRandomValues(buf);
  return ((buf[0] << 8) | buf[1]) & 0x0fff;
}

/**
 * 生成符合 RFC 9562 标准的 UUIDv7（时间单调有序唯一标识符）。
 *
 * 结构：
 * - 0~47 位 (6 字节): Unix 毫秒时间戳 (Big-Endian)
 * - 48~51 位 (4 位): 版本号 7 (0b0111)
 * - 52~63 位 (12 位): 序列号 / 随机数计数器
 * - 64~65 位 (2 位): RFC 4122/9562 变体标识 (0b10)
 * - 66~127 位 (62 位): 高熵密码学随机数
 *
 * 优势：
 * 1. 单调递增：B-Tree 索引聚集最右插入，零页分裂 (Page Splitting)，写入性能媲美自增 ID；
 * 2. 内置时间语义：无需额外存储字段即可直接通过 ID 提取生成时间；
 * 3. 跨系统唯一：支持分布式多实例并发生成，零中心化发号器依赖。
 */
export function uuidv7(): string {
  let ts = Date.now();

  if (ts <= lastTimestamp) {
    // 同一毫秒内或时钟回拨：沿用上次时间戳并递增序列号，保证 ID 永不回退
    ts = lastTimestamp;
    seq = (seq + 1) & 0x0fff;
    // 12 位序列号溢出：时间戳进位 1ms 并重置序列号种子，维持严格单调有序
    if (seq === 0) {
      ts += 1;
      lastTimestamp = ts;
      seq = randomSeq();
    }
  } else {
    lastTimestamp = ts;
    seq = randomSeq();
  }

  const bytes = new Uint8Array(16);
  getRandomValues(bytes);

  // 1. 写入 48 位 Unix 毫秒时间戳
  bytes[0] = Math.floor(ts / 0x10000000000) & 0xff;
  bytes[1] = Math.floor(ts / 0x100000000) & 0xff;
  bytes[2] = Math.floor(ts / 0x1000000) & 0xff;
  bytes[3] = Math.floor(ts / 0x10000) & 0xff;
  bytes[4] = Math.floor(ts / 0x100) & 0xff;
  bytes[5] = ts & 0xff;

  // 2. 写入版本号 7 (0x70) + 12 位序列号高 4 位
  bytes[6] = 0x70 | ((seq >> 8) & 0x0f);
  bytes[7] = seq & 0xff;

  // 3. 写入 RFC 变体标识 (0b10xxxxxx)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  // 4. 格式化为标准 36 字符 8-4-4-4-12 连字符十六进制形式
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 校验指定字符串是否为合法的 UUID（支持 v4 与 v7）
 */
export function isUuid(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * 从 UUIDv7 中提取生成时的 Unix 毫秒时间戳
 */
export function extractTimestampFromUuidV7(uuid: string): number {
  if (!isUuid(uuid)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
  const cleanHex = uuid.replace(/-/g, '').slice(0, 12);
  return Number.parseInt(cleanHex, 16);
}
