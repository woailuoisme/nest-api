import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database-health.indicator';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';
import { StorageHealthIndicator } from './indicators/storage-health.indicator';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, RedisHealthIndicator, StorageHealthIndicator],
})
export class HealthModule {}
