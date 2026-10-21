import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { connect } from 'mqtt';

import { MqttExplorerService } from './explorer/mqtt-explorer.service';
import { IotController } from './iot.controller';
import { IotCommandService } from './services/iot-command.service';
import { IotDeviceCredentialService } from './services/iot-device-credential.service';
import { IotTelemetryService } from './services/iot-telemetry.service';
import { MQTT_CLIENT_TOKEN, MQTT_OPTIONS_TOKEN, type MqttOptions } from './transports/interfaces/mqtt.interface';
import { MqttService } from './transports/mqtt.service';
import { parseMqttDsn, resolveMqttBrokerUrl } from './transports/utils/dsn.parser';

/**
 * 工业物联网与 MQTT 5.0 设备控制核心模块
 *
 * 统一收敛：
 * 1. MQTT 5.0 传输层客户端 (MqttService) 与拓扑探索 (MqttExplorerService)。
 * 2. 声明式装饰器驱动的订阅分发机制 (@MqttSubscribe, @MqttPayload, @MqttParams, @MqttCtx)。
 * 3. 工业设备数字影子缓存与遥测领域事件分发 (IotTelemetryService)。
 * 4. 同步 RPC 指令下发与关联对比响应回执 (IotCommandService)。
 * 5. 模拟与查询 REST 控制器 (IotController)。
 *
 * 领域型模块，保持显式 import（不使用 @Global），以维持依赖关系可见性。
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [IotController],
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
        return connect(resolveMqttBrokerUrl(options), options);
      },
      inject: [MQTT_OPTIONS_TOKEN],
    },
    MqttService,
    MqttExplorerService,
    IotCommandService,
    IotTelemetryService,
    IotDeviceCredentialService,
  ],
  exports: [
    MqttService,
    MQTT_CLIENT_TOKEN,
    MQTT_OPTIONS_TOKEN,
    IotCommandService,
    IotTelemetryService,
    IotDeviceCredentialService,
  ],
})
export class IotModule {}
