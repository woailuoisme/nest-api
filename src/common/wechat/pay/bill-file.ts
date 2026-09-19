import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { WepayException } from './wepay.exception';

/** 官方固定使用的账单摘要算法 */
const SUPPORTED_HASH_TYPE = 'SHA1';

/**
 * 解压账单文件流
 *
 * 申请账单时传 `tar_type=GZIP` 会返回 `.gzip` 压缩流，需解压后才能得到 CSV 原文；
 * 未传 `tar_type` 时以数据流形式返回，原样透传。
 */
export function decompressBillFile(content: Buffer, tarType?: 'GZIP'): Buffer {
  if (tarType !== 'GZIP') {
    return content;
  }

  try {
    return gunzipSync(content);
  } catch (error) {
    throw new WepayException('WEPAY_BILL_DECOMPRESS_FAILED', `GZIP 账单文件解压失败：${(error as Error).message}`);
  }
}

/**
 * 校验账单文件完整性
 *
 * 官方要求以申请账单应答中的 `hash_value` 校验文件一致性，且摘要针对**解压后的原始账单**计算
 * （原文：「原始账单(gzip需要解压缩)的摘要值，用于校验文件的完整性」）。
 * 校验失败即视为文件损坏或被篡改，绝不把来路不明的内容交给业务侧。
 */
export function verifyBillFileHash(content: Buffer, hashType: string, hashValue: string): void {
  if (hashType.toUpperCase() !== SUPPORTED_HASH_TYPE) {
    throw new WepayException('WEPAY_BILL_HASH_TYPE_UNSUPPORTED', `不支持的账单摘要算法：${hashType}`);
  }

  const actualHash = createHash('sha1').update(content).digest('hex');
  if (actualHash !== hashValue.toLowerCase()) {
    throw new WepayException(
      'WEPAY_BILL_HASH_MISMATCH',
      `账单文件摘要不匹配（微信下发 ${hashValue}，本地计算 ${actualHash}）`,
    );
  }
}
