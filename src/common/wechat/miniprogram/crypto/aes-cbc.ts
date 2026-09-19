import { createDecipheriv } from 'node:crypto';
import { MiniprogramException } from '../miniprogram.exception';

/** AES-128-CBC 的密钥与 IV 长度（字节） */
const AES_CBC_KEY_BYTES = 16;

/** 解密后的开放数据水印 */
export interface WechatDataWatermark {
  timestamp: number;
  appid: string;
}

/** 解密后的开放数据（含官方水印字段） */
export interface WechatDecryptedData {
  watermark?: WechatDataWatermark;
  [key: string]: unknown;
}

/** 解密选项 */
export interface DecryptUserDataOptions {
  /**
   * 期望的 appid
   *
   * 传入后会校验水印中的 `watermark.appid` 是否一致。官方开放数据均带水印，
   * 校验可阻断「用其他小程序的密文冒充本小程序用户数据」的跨应用重放攻击，
   * 生产环境务必传入。
   */
  expectedAppid?: string;
}

/** 将 base64 文本解码为 Buffer，并断言长度符合 AES-128-CBC 要求 */
function decodeFixedLength(value: string, field: string, expectedBytes: number): Buffer {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(value, 'base64');
  } catch {
    throw new MiniprogramException('MINIPROGRAM_DECRYPT_FAILED', `${field} 不是合法的 base64 编码`);
  }

  if (buffer.length !== expectedBytes) {
    throw new MiniprogramException(
      'MINIPROGRAM_DECRYPT_FAILED',
      `${field} 长度必须为 ${expectedBytes} 字节（实际 ${buffer.length} 字节）`,
    );
  }
  return buffer;
}

/**
 * 解密微信旧版开放数据（AES-128-CBC + PKCS#7）
 *
 * 用于 `wx.getUserInfo` / `getPhoneNumber` 旧版组件回传的 `encryptedData` + `iv`
 * 与 `session_key` 组合解密。新版「手机号快速验证」已改为 `code` 直换，
 * 此函数仅服务于存量客户端。
 *
 * 官方要求：对称密钥为 `session_key`（base64 解码后 16 字节），初始向量为 `iv`（同 16 字节），
 * 填充方式为 PKCS#7（Node 的 `setAutoPadding(true)` 即为该语义）。
 *
 * @param sessionKey 登录时下发的会话密钥（base64）
 * @param encryptedData 密文（base64）
 * @param iv 初始向量（base64）
 * @param options 水印校验选项
 */
export function decryptUserData(
  sessionKey: string,
  encryptedData: string,
  iv: string,
  options: DecryptUserDataOptions = {},
): WechatDecryptedData {
  const key = decodeFixedLength(sessionKey, 'session_key', AES_CBC_KEY_BYTES);
  const ivBuffer = decodeFixedLength(iv, 'iv', AES_CBC_KEY_BYTES);

  let plaintext: string;
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, ivBuffer);
    decipher.setAutoPadding(true);
    const ciphertext = Buffer.from(encryptedData, 'base64');
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    throw new MiniprogramException(
      'MINIPROGRAM_DECRYPT_FAILED',
      `用户数据解密失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: WechatDecryptedData;
  try {
    parsed = JSON.parse(plaintext) as WechatDecryptedData;
  } catch {
    throw new MiniprogramException('MINIPROGRAM_DECRYPT_FAILED', '用户数据解密结果不是合法 JSON');
  }

  const watermarkAppid = parsed.watermark?.appid;
  if (options.expectedAppid && watermarkAppid !== options.expectedAppid) {
    throw new MiniprogramException(
      'MINIPROGRAM_DECRYPT_FAILED',
      `用户数据水印 appid 不匹配（期望 ${options.expectedAppid}，实际 ${watermarkAppid ?? '缺失'}）`,
    );
  }

  return parsed;
}
