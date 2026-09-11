import type { DeviceTelemetryDto } from '@/features/system/iot/dto/iot.dto';

export const IOT_EVENTS = {
  TELEMETRY_RECEIVED: 'iot.telemetry.received',
  STATUS_CHANGED: 'iot.device.status_changed',
  ALARM_TRIGGERED: 'iot.alarm.triggered',
  COMMAND_EXECUTED: 'iot.command.executed',
} as const;

export type IotEventType = (typeof IOT_EVENTS)[keyof typeof IOT_EVENTS];

/**
 * 设备遥测数据到达事件
 */
export interface IotTelemetryReceivedEvent {
  tenantId: string;
  deviceId: string;
  telemetry: DeviceTelemetryDto;
  timestamp: number;
}

/**
 * 工业设备在线/遗嘱离线状态变更事件
 */
export interface IotDeviceStatusChangedEvent {
  tenantId: string;
  deviceId: string;
  status: 'online' | 'offline';
  reason?: string;
  timestamp: number;
}

/**
 * 工业阈值超限告警事件
 */
export interface IotAlarmTriggeredEvent {
  tenantId: string;
  deviceId: string;
  level: 'warning' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: number;
}

/**
 * 工业设备指令下发与 RPC 执行回执事件
 */
export interface IotCommandExecutedEvent {
  deviceId: string;
  command: string;
  success: boolean;
  params?: Record<string, unknown>;
  data?: unknown;
  elapsedMs: number;
  timestamp: number;
}
