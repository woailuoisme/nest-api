import { Logger } from '@nestjs/common';
import type { IdempotencyEvent, IdempotencyEvents } from '@nestjs/idempotency';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IdempotencyEventsListener } from '@/common/idempotency/idempotency-events.listener';

function createListener() {
  const subject = new Subject<IdempotencyEvent>();
  const events = { events$: subject.asObservable() } as unknown as IdempotencyEvents;
  const listener = new IdempotencyEventsListener(events);
  listener.onModuleInit();

  return { listener, subject };
}

describe('IdempotencyEventsListener', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lock-lost 必须按 error 记录（结果未入 store，重试可能重跑 handler）', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error');
    const { listener, subject } = createListener();

    subject.next({
      type: 'lock-lost',
      context: 'http',
      handler: 'OrdersController.pay',
      key: 'key-1',
      phase: 'complete',
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('lock lost during complete'));

    listener.onModuleDestroy();
  });

  it('rejected 应以 warn 记录并带上 code 与 status', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');
    const { listener, subject } = createListener();

    subject.next({
      type: 'rejected',
      context: 'http',
      handler: 'OrdersController.pay',
      key: 'key-1',
      code: 'IDEMPOTENCY_KEY_IN_USE',
      status: 409,
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('IDEMPOTENCY_KEY_IN_USE'));

    listener.onModuleDestroy();
  });

  it('replayed 应以 debug 记录（正常回放不产生告警噪音）', () => {
    const debugSpy = vi.spyOn(Logger.prototype, 'debug');
    const { listener, subject } = createListener();

    subject.next({ type: 'replayed', context: 'http', handler: 'OrdersController.pay', key: 'key-1', status: 201 });

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('replayed'));

    listener.onModuleDestroy();
  });

  it('onModuleDestroy 后应停止接收事件（避免热重载泄漏订阅）', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error');
    const { listener, subject } = createListener();

    listener.onModuleDestroy();
    subject.next({
      type: 'lock-lost',
      context: 'http',
      handler: 'OrdersController.pay',
      key: 'key-1',
      phase: 'extend',
    });

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
