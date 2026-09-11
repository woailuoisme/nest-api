import { Module } from '@nestjs/common';
import { IotController } from './iot.controller';
import { IotCommandService } from './iot-command.service';
import { IotTelemetryService } from './iot-telemetry.service';

/**
 * 工业物联网与设备管理特性模块
 *
 * 聚合设备遥测监听、影子缓存与基于 MQTT 5.0 的 RPC 指令控制能力。
 */
@Module({
  controllers: [IotController],
  providers: [IotTelemetryService, IotCommandService],
  exports: [IotTelemetryService, IotCommandService],
})
export class IotModule {}
