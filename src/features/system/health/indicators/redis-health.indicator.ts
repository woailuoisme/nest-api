import { Inject, Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '@/database/redis.module';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    return this.healthIndicatorService
      .check(key)
      .attempt(async () => {
        if (this.redisClient.status === 'wait') {
          await this.redisClient.connect();
        }
        if ((await this.redisClient.ping()) !== 'PONG') {
          throw new Error('Unexpected Redis ping response');
        }
      })
      .withTimeout('1.5s');
  }
}
