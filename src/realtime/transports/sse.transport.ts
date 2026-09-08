import { randomUUID } from 'node:crypto';
import { Injectable, type MessageEvent, type OnModuleDestroy, Optional } from '@nestjs/common';
import { concatMap, filter, map, type Observable, Subject } from 'rxjs';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ChannelManager } from '../channels/channel-manager.service';
import type { RealtimeEnvelope } from '../realtime.dto';
import type { RealtimeTransport } from './realtime-transport.interface';

/**
 * Server-Sent Events (SSE) 传输适配器
 * 基于纯响应式 RxJS Subject 实现无锁广播、精准定向推送与基于 ChannelManager 的频道动态鉴权。
 */
@Injectable()
export class SseTransport implements RealtimeTransport, OnModuleDestroy {
  readonly name = 'sse';
  private readonly stream$ = new Subject<RealtimeEnvelope>();

  constructor(@Optional() private readonly channelManager?: ChannelManager) {}

  onModuleDestroy(): void {
    this.stream$.complete();
  }

  sendToUser<T = unknown>(envelope: RealtimeEnvelope<T>): void {
    this.stream$.next(envelope as RealtimeEnvelope);
  }

  broadcast<T = unknown>(envelope: RealtimeEnvelope<T>): void {
    this.stream$.next(envelope as RealtimeEnvelope);
  }

  /**
   * 为指定用户订阅专属 SSE 消息流（支持 ChannelManager 频道权限动态拦截）
   * @param user 目标用户上下文或用户 ID
   */
  subscribe(user: CurrentUserPayload | string): Observable<MessageEvent> {
    const userPayload: CurrentUserPayload = typeof user === 'string' ? { id: user, email: '', role: Role.USER } : user;

    return this.stream$.asObservable().pipe(
      concatMap(async (envelope) => {
        // 1. 用户定向单播
        if (envelope.targetUserId !== null && envelope.targetUserId !== undefined) {
          return envelope.targetUserId === userPayload.id ? envelope : null;
        }

        // 2. 频道广播事件（根据频道类型与 ChannelManager 规则进行授权准入判定）
        if (envelope.channel) {
          if (this.channelManager) {
            const auth = await this.channelManager.canSubscribe(userPayload, envelope.channel);
            return auth.authorized ? envelope : null;
          }

          // 无 ChannelManager 时的安全保底（Fail-Closed）：阻断所有 private / presence 频道
          const normalized = envelope.channel.replace(/^private[-:]/, 'private:').replace(/^presence[-:]/, 'presence:');
          if (normalized.startsWith('private:') || normalized.startsWith('presence:')) {
            return null;
          }
          return envelope;
        }

        // 3. 无特定频道且无目标用户的全网系统级广播
        return envelope;
      }),
      filter((envelope): envelope is RealtimeEnvelope => envelope !== null),
      map(
        (envelope): MessageEvent => ({
          id: randomUUID(),
          type: envelope.event,
          data:
            typeof envelope.data === 'string' || (typeof envelope.data === 'object' && envelope.data !== null)
              ? (envelope.data as string | object)
              : String(envelope.data),
          retry: 10_000,
        }),
      ),
    );
  }
}
