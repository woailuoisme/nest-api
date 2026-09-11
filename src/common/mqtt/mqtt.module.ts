import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { connect } from 'mqtt';
import { MqttExplorerService } from './explorer/mqtt-explorer.service';
import { MQTT_CLIENT_TOKEN, MQTT_OPTIONS_TOKEN, type MqttOptions } from './interfaces/mqtt.interface';
import { MqttService } from './mqtt.service';
import { parseMqttDsn } from './utils/dsn.parser';

/**
 * 全局 MQTT 5.0 物联网通信与设备控制模块
 *
 * 自动从环境配置读取 MQTT_URL，若未配置则静默处于未激活状态（Graceful Inactive），
 * 不影响其他非 IoT 业务服务的正常启动。
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    {
      provide: MQTT_OPTIONS_TOKEN,
      useFactory: (configService: ConfigService): MqttOptions | null => {
        const dsn = configService.get<string>('MQTT_URL');
        return dsn ? parseMqttDsn(dsn) : null;
      },
      inject: [ConfigService],
    },
    {
      provide: MQTT_CLIENT_TOKEN,
      useFactory: (options: MqttOptions | null) => {
        if (!options) return null;
        const brokerUrl = options.url || `${options.protocol}://${options.host}:${options.port}`;
        return connect(brokerUrl, options);
      },
      inject: [MQTT_OPTIONS_TOKEN],
    },
    MqttService,
    MqttExplorerService,
  ],
  exports: [MqttService, MQTT_CLIENT_TOKEN, MQTT_OPTIONS_TOKEN],
})
export class MqttModule {}
