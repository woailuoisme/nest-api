import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decompressBillFile, verifyBillFileHash } from '@/common/wechat/pay/bill-file';
import { WepayException } from '@/common/wechat/pay/wepay.exception';

/** 含中文的账单片段，用于验证 UTF-8 往返无损 */
const BILL_CONTENT = ',商户订单号\n,MOCK-ORDER-1\n';

/** 捕获校验函数抛出的领域异常 */
function capture(fn: () => void): WepayException {
  try {
    fn();
  } catch (error) {
    return error as WepayException;
  }
  throw new Error('期望抛出 WepayException，但函数正常返回');
}

describe('账单文件解压与完整性校验', () => {
  it('未指定 GZIP 时应原样透传数据流', () => {
    const content = Buffer.from(BILL_CONTENT, 'utf8');

    expect(decompressBillFile(content)).toEqual(content);
    expect(decompressBillFile(content, undefined)).toEqual(content);
  });

  it('tar_type=GZIP 时应解压为原始 CSV', () => {
    const compressed = gzipSync(Buffer.from(BILL_CONTENT, 'utf8'));

    expect(decompressBillFile(compressed, 'GZIP').toString('utf8')).toBe(BILL_CONTENT);
  });

  it('非 GZIP 内容被标记为 GZIP 时应明确报错', () => {
    const error = capture(() => decompressBillFile(Buffer.from(BILL_CONTENT, 'utf8'), 'GZIP'));

    expect(error.wepayCode).toBe('WEPAY_BILL_DECOMPRESS_FAILED');
    expect(error.getStatus()).toBe(502);
  });

  it('摘要一致时应通过校验（大小写不敏感）', () => {
    const content = Buffer.from(BILL_CONTENT, 'utf8');
    const digest = createHash('sha1').update(content).digest('hex');

    expect(() => verifyBillFileHash(content, 'SHA1', digest)).not.toThrow();
    expect(() => verifyBillFileHash(content, 'sha1', digest.toUpperCase())).not.toThrow();
  });

  it('摘要不一致时应拒绝该文件', () => {
    const error = capture(() => verifyBillFileHash(Buffer.from(BILL_CONTENT, 'utf8'), 'SHA1', 'x'.repeat(40)));

    expect(error.wepayCode).toBe('WEPAY_BILL_HASH_MISMATCH');
    expect(error.getStatus()).toBe(502);
    expect(error.message).toContain('账单文件摘要不匹配');
  });

  it('官方固定使用 SHA1，其他算法应明确报错而非静默跳过校验', () => {
    const error = capture(() => verifyBillFileHash(Buffer.from(BILL_CONTENT, 'utf8'), 'MD5', 'whatever'));

    expect(error.wepayCode).toBe('WEPAY_BILL_HASH_TYPE_UNSUPPORTED');
    expect(error.getStatus()).toBe(500);
  });

  it('摘要应对解压后的原始账单计算（gzip 场景）', () => {
    const original = Buffer.from(BILL_CONTENT, 'utf8');
    const decompressed = decompressBillFile(gzipSync(original), 'GZIP');

    expect(() =>
      verifyBillFileHash(decompressed, 'SHA1', createHash('sha1').update(original).digest('hex')),
    ).not.toThrow();
    // 若误用压缩后字节的摘要则应失败
    const compressedDigest = createHash('sha1').update(gzipSync(original)).digest('hex');
    expect(capture(() => verifyBillFileHash(decompressed, 'SHA1', compressedDigest)).wepayCode).toBe(
      'WEPAY_BILL_HASH_MISMATCH',
    );
  });
});
