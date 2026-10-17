import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { MqttService } from '@/iot';

/**
 * MQTT 5.0 物联网 Broker 健康检查指示器
 */
@Injectable()
export class MqttHealthIndicator {
  constructor(
    private readonly mqttService: MqttService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key = 'mqtt'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    const client = this.mqttService.getClient();
    if (!client) {
      return indicator.up({
        connection: 'inactive',
        message: 'MQTT is not configured',
      });
    }

    if (this.mqttService.isConnected()) {
      return indicator.up({
        connection: 'connected',
        replyTopic: this.mqttService.getReplyTopic(),
        reconnectAttempts: this.mqttService.getReconnectAttempts(),
      });
    }

    // 软依赖容灾降级：报告 degraded 避免导致整机 503
    return indicator.up({
      state: 'degraded',
      connection: 'disconnected',
      reconnectAttempts: this.mqttService.getReconnectAttempts(),
      message: 'MQTT client is disconnected or reconnecting',
    });
  }
}
