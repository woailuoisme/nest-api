import { PasswordHasher } from '@nestjs/authentication';
import { ConflictException, Injectable } from '@nestjs/common';

import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

import { UsersRepository } from './users.repository';

/**
 * 密码注册与校验（官方 `PasswordHasher`，scrypt / PHC 格式）。
 *
 * 无账号与密码错误返回同一答案、同一耗时（`verify(password, undefined)` 走哑哈希）。
 */
@Injectable()
export class CredentialsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async register(email: string, password: string): Promise<CurrentUserPayload> {
    if (await this.usersRepository.findByEmail(email)) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await this.passwordHasher.hash(password);
    return this.usersRepository.create(email, { passwordHash });
  }

  /** 用户或 `null`：邮箱不存在与密码错误给出同一答案、同一耗时 */
  async verify(email: string, password: string): Promise<CurrentUserPayload | null> {
    const found = await this.usersRepository.findCredentials(email);
    if (!found?.passwordHash) {
      await this.passwordHasher.verify(password, undefined);
      return null;
    }

    const valid = await this.passwordHasher.verify(password, found.passwordHash);
    if (!valid) {
      return null;
    }
    if (this.passwordHasher.needsRehash(found.passwordHash)) {
      await this.usersRepository.updatePasswordHash(found.user.id, await this.passwordHasher.hash(password));
    }
    return found.user.banned ? null : found.user;
  }
}
