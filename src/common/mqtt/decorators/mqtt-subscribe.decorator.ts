import { SetMetadata } from '@nestjs/common';
import { MQTT_SUBSCRIBE_METADATA, type MqttSubscribeOptions } from '../interfaces/mqtt.interface';

/**
 * 声明方法订阅指定 MQTT 主题模式
 *
 * 示例：
 *   @MqttSubscribe('devices/:deviceId/telemetry', { qos: 1, sharedGroup: 'telemetry-workers' })
 *   async handleTelemetry(@MqttPayload() data: SensorData, @MqttParams('deviceId') deviceId: string) {}
 */
export function MqttSubscribe(pattern: string, options: MqttSubscribeOptions = {}): MethodDecorator {
  return (target: object, key: string | symbol, descriptor: PropertyDescriptor) => {
    SetMetadata(MQTT_SUBSCRIBE_METADATA, {
      pattern,
      options,
    })(target, key, descriptor);
    return descriptor;
  };
}
