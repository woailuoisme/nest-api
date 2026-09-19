import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** GCM 认证标签长度（字节），微信支付将其拼接在密文尾部 */
const GCM_AUTH_TAG_LENGTH_BYTES = 16;

/** APIv3 密钥长度（AES-256 要求 32 字节） */
const API_V3_KEY_BYTES = 32;

/** 微信支付 v3 密文资源结构（回调 resource 与平台证书共用） */
export interface AesGcmResource {
  algorithm?: string;
  ciphertext: string;
  nonce: string;
  associated_data?: string;
}

/** 解析并校验 APIv3 密钥长度 */
function resolveApiV3Key(apiV3Key: string): Buffer {
  const key = Buffer.from(apiV3Key, 'utf8');
  if (key.length !== API_V3_KEY_BYTES) {
    throw new Error(`微信支付 APIv3 密钥必须为 ${API_V3_KEY_BYTES} 字节，当前为 ${key.length} 字节`);
  }
  return key;
}

/**
 * 解密微信支付 v3 密文资源
 *
 * 算法为 AES-256-GCM，认证标签拼接在密文尾部，associated_data 参与完整性认证；
 * 任何长度或密钥异常均抛出普通 Error，由驱动层统一转译为 WepayException。
 */
export function decryptAesGcmResource(resource: AesGcmResource, apiV3Key: string): string {
  const key = resolveApiV3Key(apiV3Key);
  const data = Buffer.from(resource.ciphertext, 'base64');
  if (data.length <= GCM_AUTH_TAG_LENGTH_BYTES) {
    throw new Error('微信支付密文长度非法，无法拆分认证标签');
  }

  const authTag = data.subarray(data.length - GCM_AUTH_TAG_LENGTH_BYTES);
  const ciphertext = data.subarray(0, data.length - GCM_AUTH_TAG_LENGTH_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(resource.associated_data ?? '', 'utf8'));

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * 加密文本为微信支付 v3 密文格式
 *
 * 仅供 mock 驱动与单测使用：产出可被真实解密链路消费的报文，确保联调路径与生产一致。
 */
export function encryptAesGcmResource(
  plaintext: string,
  apiV3Key: string,
  associatedData = '',
  nonce = randomBytes(12).toString('hex'),
): Required<AesGcmResource> {
  const key = resolveApiV3Key(apiV3Key);
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64'),
    nonce,
    associated_data: associatedData,
  };
}
