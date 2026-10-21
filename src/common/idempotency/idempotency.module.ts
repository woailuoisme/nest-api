import { Global, Module } from '@nestjs/common';
import { IdempotencyModule as NestIdempotencyModule } from '@nestjs/idempotency';

import { isProductionEnv } from '@/common/constants/app.constants';

import { DrizzleIdempotencyStore } from './drizzle-idempotency.store';
import { IdempotencyService } from './idempotency.service';

@Global()
@Module({
  imports: [
    NestIdempotencyModule.forRootAsync({
      isGlobal: true,
      useFactory: () => ({
        // 生产禁止回落到进程内存：多副本下同一 Key 会在各副本各执行一次且无任何告警
        allowInMemoryStorage: !isProductionEnv(),
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
      }),
    }),
  ],
  providers: [DrizzleIdempotencyStore, IdempotencyService],
  exports: [DrizzleIdempotencyStore, IdempotencyService, NestIdempotencyModule],
})
export class IdempotencyModule {}
