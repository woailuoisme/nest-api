import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { INJECTION_TOKENS, REDIS_MAX_RETRIES } from '@/common/constants/app.constants';
import type { EnvConfig } from '@/config/env.validation';
import { RedisService } from './redis.service';

export const REDIS_CLIENT = INJECTION_TOKENS.REDIS_CLIENT;

const REDIS_LOGGER = new Logger('Redis');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const client = new Redis(config.get('REDIS_URL'), {
          maxRetriesPerRequest: REDIS_MAX_RETRIES,
          lazyConnect: true,
        });

        // 真实连接事件：lazyConnect=true，首次触发连接（如 /health ping）时才连
        client.on('connect', () => REDIS_LOGGER.log('Redis client connected'));
        client.on('reconnecting', () => REDIS_LOGGER.warn('Redis reconnecting'));
        client.on('close', () => REDIS_LOGGER.log('Redis client disconnected'));
        // 必须监听：ioredis 无 error 监听器时断连会崩进程
        client.on('error', (err) => REDIS_LOGGER.error(`Redis error: ${err.message}`));

        return client;
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

  async onApplicationShutdown() {
    if (this.redisClient.status !== 'end') {
      await this.redisClient.quit();
    }
  }
}
