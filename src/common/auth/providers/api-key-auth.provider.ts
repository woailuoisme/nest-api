import { ApiKeyProvider, AuthenticationRegistry, type ApiKeyRecord } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';

import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

import { ApiKeysRepository } from '../api-keys.repository';

export const API_KEY_PREFIX = 'nest';

/** Bearer API Key 凭据提供者（链中第三个，order 2） */
@Injectable()
export class ApiKeyAuthProvider extends ApiKeyProvider<CurrentUserPayload> {
  constructor(
    private readonly apiKeysRepository: ApiKeysRepository,
    registry: AuthenticationRegistry,
  ) {
    super({ prefix: API_KEY_PREFIX, realm: 'nest-api' });
    registry.registerProvider(this, { order: 2 });
  }

  protected findKey(id: string): Promise<ApiKeyRecord<CurrentUserPayload> | null> {
    return this.apiKeysRepository.findWithUser(id);
  }
}
