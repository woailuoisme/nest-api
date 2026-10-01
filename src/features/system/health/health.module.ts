import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MediaModule } from '@/common/media/media.module';
import { IotModule } from '@/iot/iot.module';
import { RealtimeModule } from '@/realtime/realtime.module';
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
  // 探针依赖的领域模块显式 import（Media/Iot/Realtime 均为非全局模块）
  imports: [TerminusModule, MediaModule, IotModule, RealtimeModule],
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
