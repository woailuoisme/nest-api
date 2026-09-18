import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─── 工业设备遥测上报 Schema & DTO ────────────────────────────────────────

export const DeviceStatusEnum = z.enum(['running', 'idle', 'warning', 'fault']);
export type DeviceStatus = z.infer<typeof DeviceStatusEnum>;

export const DeviceTelemetrySchema = z.object({
  voltage: z.number().describe('工作电压 (V)'),
  current: z.number().describe('工作电流 (A)'),
  temperature: z.number().describe('轴承/核心温度 (℃)'),
  vibration: z.number().describe('振动加速度 RMS (mm/s)'),
  status: DeviceStatusEnum.describe('设备运行工况状态'),
  timestamp: z.number().optional().describe('遥测采集时间戳 (毫秒)'),
});

export class DeviceTelemetryDto extends createZodDto(DeviceTelemetrySchema) {}

// ─── 工业设备指令下发 Schema & DTO ────────────────────────────────────────

export const SendCommandSchema = z.object({
  command: z.string().min(1).describe('指令名称 (如 setSpeed, emergencyStop, calibrate)'),
  params: z.record(z.string(), z.unknown()).optional().describe('指令附加参数字典'),
  timeoutMs: z.number().int().min(500).max(60000).default(5000).optional().describe('等待设备响应超时阈值 (毫秒)'),
});

export class SendCommandDto extends createZodDto(SendCommandSchema) {}

// ─── 模拟遥测测试 Schema & DTO ────────────────────────────────────────────

export const MockTelemetrySchema = z.object({
  tenantId: z.string().default('tenant-01').describe('租户 ID'),
  deviceId: z.string().default('plc-01').describe('设备序列号 / 标识符'),
  telemetry: DeviceTelemetrySchema.describe('遥测数据载荷'),
});

export class MockTelemetryDto extends createZodDto(MockTelemetrySchema) {}

// ─── 设备安全凭证签发 Schema & DTO ──────────────────────────────────────────

export const DeviceTokenRequestSchema = z.object({
  deviceId: z.string().min(1).describe('设备唯一标识符 (UUID / 序列号)'),
  deviceSecret: z.string().min(6).describe('设备预置通信密钥 (Pre-Shared Secret)'),
  tenantId: z.string().default('default').optional().describe('所属租户 ID'),
});

export class DeviceTokenRequestDto extends createZodDto(DeviceTokenRequestSchema) {}

export class DeviceTokenResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: 'Mosquitto 认证专用 JWT 凭证' })
  token: string;

  @ApiProperty({ example: 2592000, description: '凭据有效期 (秒，默认 30 天)' })
  expiresIn: number;

  @ApiProperty({ example: 'mqtt://localhost:1883', description: 'Mosquitto Broker 连接端点' })
  brokerUrl: string;
}

// ─── 工业设备突发硬件告警事件 Schema & DTO ──────────────────────────────────────

export const DeviceCriticalEventSchema = z.object({
  tenantId: z.string().default('default').describe('租户 ID'),
  deviceId: z.string().min(1).describe('设备序列号'),
  level: z.enum(['warning', 'critical']).default('warning').describe('告警等级'),
  metric: z.string().describe('告警测点或类型 (如 e_stop, over_temp, vibration_limit)'),
  value: z.number().describe('触发时测点数值'),
  threshold: z.number().describe('报警设定阈值'),
  message: z.string().describe('报警详细描述'),
  timestamp: z.number().optional().describe('事件发生时间戳 (毫秒)'),
});

export class DeviceCriticalEventDto extends createZodDto(DeviceCriticalEventSchema) {}

// ─── 设备在线/遗嘱状态变更 Schema & DTO ────────────────────────────────────────

export const DeviceStatusPayloadSchema = z.object({
  status: z.enum(['online', 'offline']).describe('设备在线状态'),
  reason: z.string().optional().describe('状态变更原因 (如 normal_boot, LWT_timeout)'),
  timestamp: z.number().optional().describe('状态变更时间戳 (毫秒)'),
});

export type DeviceStatusPayload = z.infer<typeof DeviceStatusPayloadSchema>;

export class DeviceStatusPayloadDto extends createZodDto(DeviceStatusPayloadSchema) {}

// ─── 实体模型定义 ──────────────────────────────────────────────────────────

export class DeviceShadowEntity {
  @ApiProperty({ example: 'plc-01', description: '设备序列号' })
  deviceId: string;

  @ApiProperty({ example: 'tenant-01', description: '所属租户ID' })
  tenantId: string;

  @ApiProperty({ example: true, description: '设备是否在线 (基于 LWT 遗嘱消息感知)' })
  online: boolean;

  @ApiProperty({ example: '2026-09-11T08:30:00.000Z', description: '最后一次通信时间' })
  lastSeenAt: string;

  @ApiProperty({ type: () => DeviceTelemetryDto, nullable: true, description: '最新遥测影子快照' })
  telemetry: DeviceTelemetryDto | null;
}

export class CommandResponseEntity {
  @ApiProperty({ example: true, description: '指令执行是否成功' })
  success: boolean;

  @ApiProperty({ example: 'plc-01', description: '目标设备ID' })
  deviceId: string;

  @ApiProperty({ example: 'setSpeed', description: '下发指令名称' })
  command: string;

  @ApiProperty({ example: { ack: true, currentRpm: 1500 }, description: '设备返回的执行结果' })
  data: unknown;

  @ApiProperty({ example: 42, description: 'RPC 往返耗时 (毫秒)' })
  elapsedMs: number;
}
