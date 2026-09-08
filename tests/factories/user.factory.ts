/**
 * 用户测试数据工厂
 *
 * 使用 faker 生成随机但可靠的测试用户数据，
 * 避免硬编码导致测试间意外的数据耦合。
 */
import { faker } from '@faker-js/faker';

export interface MockUser {
  id: string;
  name: string;
  email: string;
  role: string;
  passwordHash?: string;
  image?: string | null;
  avatarUrl?: string | null;
  emailVerified: boolean;
  emailVerifiedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建模拟用户，未传字段自动填充随机值 */
export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  const password = faker.internet.password();
  return {
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    email: faker.internet.email(),
    role: 'USER',
    passwordHash: `hashed:${password}`,
    image: null,
    avatarUrl: null,
    emailVerified: false,
    emailVerifiedAt: null,
    createdAt: faker.date.past(),
    updatedAt: faker.date.recent(),
    ...overrides,
  };
}
