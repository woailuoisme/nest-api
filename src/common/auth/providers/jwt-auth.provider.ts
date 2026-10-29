import { AuthenticationRegistry, JwtBearerProvider, type JwtClaims } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';

import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

import { UsersRepository } from '../users.repository';

/** Bearer JWT 凭据提供者（链中第二个，order 1） */
@Injectable()
export class JwtAuthProvider extends JwtBearerProvider<CurrentUserPayload> {
  constructor(
    private readonly usersRepository: UsersRepository,
    registry: AuthenticationRegistry,
  ) {
    super({ realm: 'nest-api' });
    registry.registerProvider(this, { order: 1 });
  }

  async validate({ sub }: JwtClaims): Promise<CurrentUserPayload | null> {
    if (!sub) {
      return null;
    }
    const user = await this.usersRepository.findById(sub);
    return user && !user.banned ? user : null;
  }
}
