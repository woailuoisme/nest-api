import { Injectable } from '@nestjs/common';

import { ApiKeysRepository } from './api-keys.repository';
import { API_KEY_PREFIX, ApiKeyAuthProvider } from './providers/api-key-auth.provider';

const DEFAULT_TTL_DAYS = 365;
const MAX_TTL_DAYS = 3650;

/** 对外暴露的 Key 摘要（不含 hash 与内部状态列） */
export interface ApiKeySummary {
  id: string;
  name: string | null;
  prefix: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
}

export interface CreatedApiKey {
  id: string;
  name: string | null;
  key: string;
  prefix: string;
  expiresAt: Date;
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly apiKeysRepository: ApiKeysRepository,
    private readonly provider: ApiKeyAuthProvider,
  ) {}

  async create(userId: string, name: string | null, expiresInDays = DEFAULT_TTL_DAYS): Promise<CreatedApiKey> {
    const days = Math.min(Math.max(expiresInDays, 1), MAX_TTL_DAYS);
    const generated = this.provider.generate();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 86_400_000);

    await this.apiKeysRepository.create({
      id: generated.id,
      userId,
      name,
      prefix: API_KEY_PREFIX,
      hash: generated.hash,
      createdAt: now,
      expiresAt,
      lastUsedAt: null,
      revoked: false,
    });

    return { id: generated.id, name, key: generated.key, prefix: API_KEY_PREFIX, expiresAt };
  }

  async list(userId: string): Promise<ApiKeySummary[]> {
    const rows = await this.apiKeysRepository.listByUser(userId);
    // 显式投影：新增内部列（hash / revoked / userId）不会随 select() 自动出现在响应里
    return rows.map(({ id, name, prefix, createdAt, expiresAt, lastUsedAt }) => ({
      id,
      name,
      prefix,
      createdAt,
      expiresAt,
      lastUsedAt,
    }));
  }

  revoke(userId: string, id: string): Promise<boolean> {
    return this.apiKeysRepository.revoke(userId, id);
  }
}
