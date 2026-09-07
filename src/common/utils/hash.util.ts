import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';

/** Laravel 风格哈希门面：使用 argon2id 进行密码哈希和验证 */
export const Hash = {
  /**
   * 使用 argon2id 对明文密码进行哈希
   * @param plain - 明文密码
   * @returns argon2id 哈希字符串（如 $argon2id$v=19$m=65536,t=3,p=4$...）
   */
  async make(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MiB — OWASP 推荐
      timeCost: 3, // 3 次迭代
      parallelism: 4, // 4 线程并行
    });
  },

  /**
   * 验证明文密码与 argon2id 哈希是否匹配
   * @param plain - 明文密码
   * @param hash - 已存储的 argon2id 哈希
   */
  async check(plain: string, hash: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  },
};

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
