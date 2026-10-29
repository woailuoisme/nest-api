import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { IdempotencyEvents, type IdempotencyEvent } from '@nestjs/idempotency';
import type { Subscription } from 'rxjs';

/**
 * 幂等事件观测：把官方 `IdempotencyEvents` 的 `replayed` / `rejected` / `lock-lost` 落成结构化日志。
 *
 * `lock-lost` 必须按 error 记录并接入告警：它意味着该次尝试的结果没有进入 store，重试可能
 * 再次执行 handler（对支付类端点等价于重复扣款风险）。
 */
@Injectable()
export class IdempotencyEventsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdempotencyEventsListener.name);
  private subscription?: Subscription;

  constructor(private readonly events: IdempotencyEvents) {}

  onModuleInit(): void {
    this.subscription = this.events.events$.subscribe((event) => this.log(event));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private log(event: IdempotencyEvent): void {
    const target = `${event.context} ${event.handler}`;

    if (event.type === 'lock-lost') {
      this.logger.error(
        `Idempotency lock lost during ${event.phase} for ${target}: result not stored, a retry may run the handler again`,
      );
      return;
    }

    if (event.type === 'rejected') {
      this.logger.warn(`Idempotency rejected (${event.code}, status ${event.status}) for ${target}`);
      return;
    }

    this.logger.debug(`Idempotency replayed (status ${event.status}) for ${target}`);
  }
}
