import { AuthenticationEvents } from '@nestjs/authentication';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Subscription } from 'rxjs';

import { ApiKeysRepository } from './api-keys.repository';

/** 密码重置或「退出所有设备」后吊销全部 API Key，避免旧 key 在凭据轮换后仍然有效 */
@Injectable()
export class ApiKeyRevocationListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiKeyRevocationListener.name);
  private subscription?: Subscription;

  constructor(
    private readonly events: AuthenticationEvents,
    private readonly apiKeysRepository: ApiKeysRepository,
  ) {}

  onModuleInit(): void {
    this.subscription = this.events.events$.subscribe((event) => {
      const shouldRevoke = event.type === 'password-reset' || (event.type === 'sign-out' && event.everywhere === true);
      if (!shouldRevoke) {
        return;
      }
      void this.apiKeysRepository
        .revokeAll(event.userId)
        .then((count) => {
          if (count > 0) {
            this.logger.log(`Revoked ${count} API key(s) for user ${event.userId} (${event.type})`);
          }
        })
        .catch((error: Error) => this.logger.warn(`API key revocation failed for ${event.userId}: ${error.message}`));
    });
  }

  /** 与 `IdempotencyEventsListener` 保持一致：显式退订，避免容器重建时订阅累积 */
  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
