/**
 * Token 测试数据工厂
 *
 * 生成模拟 JWT token 对与 refresh token 记录。
 */
import { faker } from '@faker-js/faker';

export interface MockTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface MockRefreshToken {
  id: number;
  tokenHash: string;
  userId: number;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

/** 创建模拟 JWT token 对 */
export function createMockTokenPair(overrides: Partial<MockTokenPair> = {}): MockTokenPair {
  return {
    accessToken: `eyJhbGciOiJIUzI1NiJ9.${faker.string.alphanumeric(32)}`,
    refreshToken: faker.string.alphanumeric(64),
    ...overrides,
  };
}

/** 创建模拟 refresh token 数据库记录 */
export function createMockRefreshToken(overrides: Partial<MockRefreshToken> = {}): MockRefreshToken {
  return {
    id: faker.number.int({ min: 1, max: 999999 }),
    tokenHash: faker.string.hexadecimal({ length: 64 }),
    userId: faker.number.int({ min: 1, max: 999999 }),
    revokedAt: null,
    expiresAt: faker.date.future(),
    createdAt: faker.date.past(),
    ...overrides,
  };
}
