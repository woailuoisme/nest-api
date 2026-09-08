import { delay } from 'es-toolkit';
import { firstValueFrom, toArray } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ChannelManager } from '@/realtime/channels/channel-manager.service';
import { SseTransport } from '@/realtime/transports/sse.transport';

describe('SseTransport', () => {
  let transport: SseTransport;
  let channelManager: ChannelManager;

  const normalUser: CurrentUserPayload = {
    id: '01931234-0000-7000-8000-000000000001',
    email: 'user@example.com',
    role: Role.USER,
  };
  const adminUser: CurrentUserPayload = {
    id: '01931234-0000-7000-8000-000000000099',
    email: 'admin@example.com',
    role: Role.ADMIN,
  };

  beforeEach(() => {
    channelManager = new ChannelManager();
    transport = new SseTransport(channelManager);
  });

  it('subscribe 应正确过滤用户专属单播事件', async () => {
    const user1Events: any[] = [];
    const user2Events: any[] = [];

    const sub1 = transport.subscribe('01931234-0000-7000-8000-000000000001').subscribe((e) => user1Events.push(e));
    const sub2 = transport.subscribe('01931234-0000-7000-8000-000000000002').subscribe((e) => user2Events.push(e));

    // 用户 1 专属事件
    transport.sendToUser({
      event: 'user:alert',
      targetUserId: '01931234-0000-7000-8000-000000000001',
      data: { msg: 'hello user 1' },
      timestamp: Date.now(),
    });

    // 等待微任务处理
    await delay(10);

    expect(user1Events).toHaveLength(1);
    expect(user2Events).toHaveLength(0);
    expect(user1Events[0].type).toBe('user:alert');

    sub1.unsubscribe();
    sub2.unsubscribe();
  });

  it('公开频道广播事件应向所有已连接用户放行', async () => {
    const userEvents: any[] = [];
    const sub = transport.subscribe(normalUser).subscribe((e) => userEvents.push(e));

    transport.broadcast({
      event: 'system:ping',
      channel: 'system',
      data: { time: 123 },
      timestamp: Date.now(),
    });

    await delay(10);

    expect(userEvents).toHaveLength(1);
    expect(userEvents[0].type).toBe('system:ping');

    sub.unsubscribe();
  });

  it('私有频道广播应经过 ChannelManager 权限校验：普通用户被阻断，特权用户放行', async () => {
    const userEvents: any[] = [];
    const adminEvents: any[] = [];

    const subUser = transport.subscribe(normalUser).subscribe((e) => userEvents.push(e));
    const subAdmin = transport.subscribe(adminUser).subscribe((e) => adminEvents.push(e));

    // 1. 向管理员私有频道广播
    transport.broadcast({
      event: 'admin:metrics',
      channel: 'private:admin.metrics',
      data: { cpu: 99 },
      timestamp: Date.now(),
    });

    // 2. 向用户 1 私有频道广播
    transport.broadcast({
      event: 'user:secret',
      channel: 'private:user.01931234-0000-7000-8000-000000000001',
      data: { token: 'secret-123' },
      timestamp: Date.now(),
    });

    // 3. 向用户 2 私有频道广播
    transport.broadcast({
      event: 'user:secret',
      channel: 'private:user.01931234-0000-7000-8000-000000000002',
      data: { token: 'secret-456' },
      timestamp: Date.now(),
    });

    await delay(20);

    // 普通用户仅收到属于自己的 private:user.1，无法收到 private:admin.metrics 和 private:user.2
    expect(userEvents).toHaveLength(1);
    expect(userEvents[0].type).toBe('user:secret');

    // 管理员收到 private:admin.metrics，但无法收到 private:user.1 和 private:user.2
    expect(adminEvents).toHaveLength(1);
    expect(adminEvents[0].type).toBe('admin:metrics');

    subUser.unsubscribe();
    subAdmin.unsubscribe();
  });

  it('onModuleDestroy 应触发流 complete', () => {
    let completed = false;
    transport.subscribe('01931234-0000-7000-8000-000000000001').subscribe({
      complete: () => {
        completed = true;
      },
    });

    transport.onModuleDestroy();
    expect(completed).toBe(true);
  });
});
