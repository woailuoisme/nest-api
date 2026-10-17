import { describe, expect, it } from 'vitest';

import { extractRouteParams, matchMqttTopic, toMqttTopic } from '@/iot';

describe('MQTT 主题匹配与参数提取 (TopicMatcher)', () => {
  describe('toMqttTopic', () => {
    it('应将命名路由参数 (:param) 转换为 MQTT 标准单层通配符 (+)', () => {
      expect(toMqttTopic('devices/:tenantId/:deviceId/telemetry')).toBe('devices/+/+/telemetry');
    });

    it('无参数路径应保持原样', () => {
      expect(toMqttTopic('factory/sensor/temperature')).toBe('factory/sensor/temperature');
    });

    it('配置 sharedGroup 时应自动添加 MQTT 5.0 共享订阅前缀 ($share/{group}/)', () => {
      expect(toMqttTopic('devices/:tenantId/:deviceId/telemetry', 'telemetry-workers')).toBe(
        '$share/telemetry-workers/devices/+/+/telemetry',
      );
    });
  });

  describe('matchMqttTopic', () => {
    it('精确路径应完全匹配', () => {
      expect(matchMqttTopic('factory/line1/sensor', 'factory/line1/sensor')).toBe(true);
      expect(matchMqttTopic('factory/line1/sensor', 'factory/line2/sensor')).toBe(false);
    });

    it('应支持单层通配符 (+)', () => {
      expect(matchMqttTopic('factory/+/sensor', 'factory/line1/sensor')).toBe(true);
      expect(matchMqttTopic('factory/+/sensor', 'factory/line2/sensor')).toBe(true);
      expect(matchMqttTopic('factory/+/sensor', 'factory/line1/sub/sensor')).toBe(false);
    });

    it('应支持多层通配符 (#)', () => {
      expect(matchMqttTopic('factory/#', 'factory/line1/sensor')).toBe(true);
      expect(matchMqttTopic('factory/#', 'factory/line1/machine2/vibration')).toBe(true);
      expect(matchMqttTopic('factory/#', 'other/line1')).toBe(false);
    });

    it('订阅模板带有 $share 共享前缀时应自动剥离后再匹配上报的主题', () => {
      expect(matchMqttTopic('$share/cluster-group/devices/+/telemetry', 'devices/dev-001/telemetry')).toBe(true);
    });
  });

  describe('extractRouteParams', () => {
    it('应从动态主题路径中精准解构命名参数字典', () => {
      const pattern = 'devices/:tenantId/:deviceId/telemetry';
      const topic = 'devices/tenant-alpha/plc-007/telemetry';

      const params = extractRouteParams(pattern, topic);
      expect(params).toEqual({
        tenantId: 'tenant-alpha',
        deviceId: 'plc-007',
      });
    });

    it('主题与模式层级不匹配时应返回 null', () => {
      const pattern = 'devices/:tenantId/:deviceId/telemetry';
      const topic = 'devices/tenant-alpha/plc-007/telemetry/extra';

      expect(extractRouteParams(pattern, topic)).toBeNull();
    });

    it('无参数模式匹配成功时应返回空对象', () => {
      const pattern = 'factory/line1/alerts';
      const topic = 'factory/line1/alerts';

      expect(extractRouteParams(pattern, topic)).toEqual({});
    });

    it('模式带有 $share 共享前缀时应剥离后正确提取参数', () => {
      const pattern = '$share/workers/devices/:deviceId/command';
      const topic = 'devices/plc-100/command';

      expect(extractRouteParams(pattern, topic)).toEqual({
        deviceId: 'plc-100',
      });
    });
  });
});
