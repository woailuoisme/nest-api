import { AuthenticationRegistry, SessionCookieProvider, type SessionRecord } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';

import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

import { UsersRepository } from '../users.repository';

/** 会话 Cookie 凭据提供者（链中第一个，order 0） */
@Injectable()
export class SessionAuthProvider extends SessionCookieProvider<CurrentUserPayload> {
  constructor(
    private readonly usersRepository: UsersRepository,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerProvider(this);
  }

  async validate(session: SessionRecord): Promise<CurrentUserPayload | null> {
    const joined = (session.extra as { user?: CurrentUserPayload } | undefined)?.user;
    const user = joined ?? (await this.usersRepository.findById(session.userId));
    return user && !user.banned ? user : null;
  }
}
