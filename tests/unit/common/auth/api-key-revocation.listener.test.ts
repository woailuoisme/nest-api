import type { AuthenticationEvents } from '@nestjs/authentication';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ApiKeyRevocationListener } from '@/common/auth/api-key-revocation.listener';
import type { ApiKeysRepository } from '@/common/auth/api-keys.repository';

type AuthEvent =
  | { type: 'password-reset'; userId: string }
  | { type: 'sign-out'; userId: string; everywhere?: boolean }
  | { type: 'signed-in'; userId: string };

function createListener() {
  const subject = new Subject<AuthEvent>();
  const events = { events$: subject.asObservable() } as unknown as AuthenticationEvents;
  const revokeAll = vi.fn().mockResolvedValue(1);
  const repository = { revokeAll } as unknown as ApiKeysRepository;
  const listener = new ApiKeyRevocationListener(events, repository);
  listener.onModuleInit();

  return { listener, subject, revokeAll };
}

/** 等待事件处理链上的 Promise 落地 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ApiKeyRevocationListener', () => {
  it('密码重置后应吊销该用户全部 API Key', async () => {
    const { listener, subject, revokeAll } = createListener();

    subject.next({ type: 'password-reset', userId: 'u1' });
    await flush();

    expect(revokeAll).toHaveBeenCalledWith('u1');
    listener.onModuleDestroy();
  });

  it('「退出所有设备」应吊销 API Key，单设备退出不应吊销', async () => {
    const { listener, subject, revokeAll } = createListener();

    subject.next({ type: 'sign-out', userId: 'u1', everywhere: false });
    await flush();
    expect(revokeAll).not.toHaveBeenCalled();

    subject.next({ type: 'sign-out', userId: 'u1', everywhere: true });
    await flush();
    expect(revokeAll).toHaveBeenCalledTimes(1);

    listener.onModuleDestroy();
  });

  it('其它认证事件不应触发吊销', async () => {
    const { listener, subject, revokeAll } = createListener();

    subject.next({ type: 'signed-in', userId: 'u1' });
    await flush();

    expect(revokeAll).not.toHaveBeenCalled();
    listener.onModuleDestroy();
  });

  it('onModuleDestroy 后应退订，不再处理事件', async () => {
    const { listener, subject, revokeAll } = createListener();

    listener.onModuleDestroy();
    subject.next({ type: 'password-reset', userId: 'u1' });
    await flush();

    expect(revokeAll).not.toHaveBeenCalled();
  });
});
