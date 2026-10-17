import { describe, expect, it } from 'vitest';

import { parseMqttDsn } from '@/iot';

describe('MQTT 5.0 DSN 解析器 (parseMqttDsn)', () => {
  it('应成功解析标准的 mqtt:// 本地地址并默认采用 MQTT 5.0', () => {
    const options = parseMqttDsn('mqtt://127.0.0.1:1883');

    expect(options.protocol).toBe('mqtt');
    expect(options.host).toBe('127.0.0.1');
    expect(options.port).toBe(1883);
    expect(options.protocolVersion).toBe(5);
    expect(options.username).toBeUndefined();
    expect(options.password).toBeUndefined();
  });

  it('应支持未指定端口时自动推导协议默认端口 (mqtt=1883, mqtts=8883, ws=9001, wss=9002)', () => {
    expect(parseMqttDsn('mqtt://broker.hivemq.com').port).toBe(1883);
    expect(parseMqttDsn('mqtts://broker.hivemq.com').port).toBe(8883);
    expect(parseMqttDsn('ws://broker.hivemq.com').port).toBe(9001);
    expect(parseMqttDsn('wss://broker.hivemq.com').port).toBe(9002);
  });

  it('应正确解析用户名与密码鉴权信息', () => {
    const options = parseMqttDsn('mqtts://industrial-operator:SecureP@ssw0rd!@iot-hub.internal:8883');

    expect(options.protocol).toBe('mqtts');
    expect(options.host).toBe('iot-hub.internal');
    expect(options.port).toBe(8883);
    expect(options.username).toBe('industrial-operator');
    expect(options.password).toBe('SecureP@ssw0rd!');
  });

  it('应支持通过 URL Query 自定义协议参数与客户端选项', () => {
    const dsn =
      'mqtt://factory-broker:1883?clientId=plc-edge-gateway&keepalive=30&clean=false&reconnectPeriod=3000&connectTimeout=15000&protocolVersion=5';
    const options = parseMqttDsn(dsn);

    expect(options.clientId).toBe('plc-edge-gateway');
    expect(options.keepalive).toBe(30);
    expect(options.clean).toBe(false);
    expect(options.reconnectPeriod).toBe(3000);
    expect(options.connectTimeout).toBe(15000);
    expect(options.protocolVersion).toBe(5);
  });

  it('应正确解析 WebSocket 路径并组装完整 brokerUrl', () => {
    const options = parseMqttDsn('ws://gateway.local:9001/mqtt');

    expect(options.protocol).toBe('ws');
    expect(options.path).toBe('/mqtt');
    expect(options.url).toBe('ws://gateway.local:9001/mqtt');
  });

  it('输入空字符串或不支持的协议方案时应抛出明确异常', () => {
    expect(() => parseMqttDsn('')).toThrow('MQTT DSN 不能为空');
    expect(() => parseMqttDsn('http://localhost:1883')).toThrow('不支持的 MQTT 协议方案');
    expect(() => parseMqttDsn('redis://localhost:6379')).toThrow('不支持的 MQTT 协议方案');
  });
});
