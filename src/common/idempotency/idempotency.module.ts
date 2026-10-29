import { Global, Module } from '@nestjs/common';
import { IdempotencyModule as NestIdempotencyModule } from '@nestjs/idempotency';

import { isProductionEnv } from '@/common/constants/app.constants';

import { DrizzleIdempotencyStore } from './drizzle-idempotency.store';
import { IdempotencyEventsListener } from './idempotency-events.listener';
import { IdempotencyService } from './idempotency.service';

/** 幂等响应加密密钥（逗号分隔、最新在前）；未配置则保持明文存储 */
function encryptionKeys(): string[] {
  return (process.env.IDEMPOTENCY_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

@Global()
@Module({
  imports: [
    NestIdempotencyModule.forRootAsync({
      isGlobal: true,
      useFactory: () => {
        const keys = encryptionKeys();
        return {
          // 生产禁止回落到进程内存：多副本下同一 Key 会在各副本各执行一次且无任何告警
          allowInMemoryStorage: !isProductionEnv(),
          // 响应含 PII（邮箱 / 收据）时启用 AES-256-GCM 加密；未配置密钥则维持明文
          ...(keys.length > 0 ? { encryption: { keys } } : {}),
          scope: {
            http: (req: unknown) => {
              const requestWithUser = req as {
                user?: { id?: string | number };
                session?: { user?: { id?: string | number } };
              };
              const user = requestWithUser?.user ?? requestWithUser?.session?.user;
              if (user?.id) {
                return `user:${user.id}`;
              }

              // 匿名流量按来源 IP 隔离：统一落回同一命名空间会让不同客户端互相命中响应缓存
              const requestWithIp = req as { ip?: string; socket?: { remoteAddress?: string } };
              const ip = requestWithIp?.ip ?? requestWithIp?.socket?.remoteAddress;
              return ip ? `anon:${ip}` : 'anon:unknown';
            },
          },
        };
      },
    }),
  ],
  providers: [DrizzleIdempotencyStore, IdempotencyService, IdempotencyEventsListener],
  exports: [DrizzleIdempotencyStore, IdempotencyService, NestIdempotencyModule],
})
export class IdempotencyModule {}
