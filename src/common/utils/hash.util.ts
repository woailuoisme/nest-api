import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/** 盐长度（字节）：16 字节 (128-bit) */
const SALT_LENGTH = 16;
/** 派生密钥长度（字节）：64 字节 (512-bit) */
const KEY_LENGTH = 64;

/** Laravel 风格哈希门面：使用 Node.js 原生 scrypt 进行密码哈希和恒定时间安全验证 */
export const Hash = {
  /**
   * 使用 scrypt 对明文密码进行安全哈希（内置动态盐）
   * @param plain - 明文密码
   * @returns `saltHex:derivedKeyHex` 格式哈希字符串
   */
  async make(plain: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const derivedKey = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
    return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
  },

  /**
   * 验证明文密码与已存储哈希是否匹配（恒定时间防时序攻击）
   * @param plain - 明文密码
   * @param hash - 已存储的 `saltHex:derivedKeyHex` 哈希
   */
  async check(plain: string, hash: string): Promise<boolean> {
    const [saltHex, keyHex] = hash.split(':');
    if (!saltHex || !keyHex) {
      return false;
    }
    const salt = Buffer.from(saltHex, 'hex');
    const key = Buffer.from(keyHex, 'hex');
    if (salt.length !== SALT_LENGTH || key.length !== KEY_LENGTH) {
      return false;
    }
    const derivedKey = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
    return timingSafeEqual(key, derivedKey);
  },
};

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
