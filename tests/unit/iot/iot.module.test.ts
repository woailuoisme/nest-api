import { describe, expect, it } from 'vitest';
import {
  IotCommandService,
  IotController,
  IotDeviceCredentialService,
  IotModule,
  IotTelemetryService,
  MQTT_CLIENT_TOKEN,
  MQTT_OPTIONS_TOKEN,
  MqttModule,
  MqttService,
} from '@/iot';

describe('IotModule (物联网与 MQTT 核心模块)', () => {
  it('应该正确导出 IotModule 与向后兼容的 MqttModule 别名', () => {
    expect(IotModule).toBeDefined();
    expect(MqttModule).toBe(IotModule);
  });

  it('应该声明 IotController 作为唯一的控制器', () => {
    const controllers = Reflect.getMetadata('controllers', IotModule) ?? [];
    expect(controllers).toContain(IotController);
  });

  it('应该声明并导出关键服务与依赖注入 Token', () => {
    const exports = Reflect.getMetadata('exports', IotModule) ?? [];
    expect(exports).toContain(MqttService);
    expect(exports).toContain(MQTT_CLIENT_TOKEN);
    expect(exports).toContain(MQTT_OPTIONS_TOKEN);
    expect(exports).toContain(IotCommandService);
    expect(exports).toContain(IotTelemetryService);
    expect(exports).toContain(IotDeviceCredentialService);
  });
});
