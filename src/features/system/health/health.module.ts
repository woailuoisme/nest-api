import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { CentrifugoHealthIndicator } from './indicators/centrifugo-health.indicator';
import { CircuitBreakerHealthIndicator } from './indicators/circuit-breaker-health.indicator';
import { DatabaseHealthIndicator } from './indicators/database-health.indicator';
import { ImgproxyHealthIndicator } from './indicators/imgproxy-health.indicator';
import { MiniprogramHealthIndicator } from './indicators/miniprogram-health.indicator';
import { MqttHealthIndicator } from './indicators/mqtt-health.indicator';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';
import { SearchHealthIndicator } from './indicators/search-health.indicator';
import { ShutdownHealthIndicator } from './indicators/shutdown-health.indicator';
import { StorageHealthIndicator } from './indicators/storage-health.indicator';
import { WepayHealthIndicator } from './indicators/wepay-health.indicator';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    StorageHealthIndicator,
    CircuitBreakerHealthIndicator,
    CentrifugoHealthIndicator,
    SearchHealthIndicator,
    ImgproxyHealthIndicator,
    MqttHealthIndicator,
    WepayHealthIndicator,
    MiniprogramHealthIndicator,
    ShutdownHealthIndicator,
  ],
})
export class HealthModule {}
