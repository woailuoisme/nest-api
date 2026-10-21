import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

// ─── 工业设备遥测上报 Schema & DTO ────────────────────────────────────────

/**
 * 设备标识 schema — 路径参数与请求体共用。
 *
 * 设备标识既可能是 UUID 也可能是产线序列号（如 `plc-01`），故不假设 UUID，
 * 但必须排除路径穿越与控制字符，避免作为 MQTT topic / 影子键使用时污染拓扑。
 */
export const DeviceIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.:-]+$/, '设备标识仅允许字母、数字与 _ . : -')
  .describe('设备唯一标识符 (UUID / 序列号)');

export const DeviceStatusEnum = z.enum(['running', 'idle', 'warning', 'fault']);

export const DeviceTelemetrySchema = z.object({
  voltage: z.number().describe('工作电压 (V)'),
  current: z.number().describe('工作电流 (A)'),
  temperature: z.number().describe('轴承/核心温度 (℃)'),
  vibration: z.number().describe('振动加速度 RMS (mm/s)'),
  status: DeviceStatusEnum.describe('设备运行工况状态'),
  timestamp: z.number().optional().describe('遥测采集时间戳 (毫秒)'),
});

export type DeviceTelemetryDto = z.infer<typeof DeviceTelemetrySchema>;

// ─── 工业设备指令下发 Schema & DTO ────────────────────────────────────────

// strict: 未知字段当前静默丢弃；收紧需同时更新真实 PLC 固件与仿真器
export const SendCommandSchema = z.object({
  command: z.string().min(1).describe('指令名称 (如 setSpeed, emergencyStop, calibrate)'),
  params: z.record(z.string(), z.unknown()).optional().describe('指令附加参数字典'),
  timeoutMs: z.number().int().min(500).max(60000).default(5000).optional().describe('等待设备响应超时阈值 (毫秒)'),
});

export type SendCommandDto = z.infer<typeof SendCommandSchema>;

// ─── 模拟遥测测试 Schema & DTO ────────────────────────────────────────────

// strict: 仿真载荷仅开发/联调使用，保留 strip 以便本地脚本随手附加上下文字段
export const MockTelemetrySchema = z.object({
  tenantId: z.string().default('tenant-01').describe('租户 ID'),
  deviceId: z.string().default('plc-01').describe('设备序列号 / 标识符'),
  telemetry: DeviceTelemetrySchema.describe('遥测数据载荷'),
});

export type MockTelemetryDto = z.infer<typeof MockTelemetrySchema>;

// ─── 设备影子查询 Schema ────────────────────────────────────────────────

/**
 * 设备影子查询参数。
 *
 * `tenantId` 仅是**查询选择器**（决定读取哪个租户的分区），不是访问控制边界——
 * 当前系统尚无「用户 ↔ 租户」归属模型，准入仅由路由角色限定（OPERATOR 以上）。
 * 后续接入租户建模后，必须改为服务端推导租户，禁止由调用方指定。
 */
export const DeviceShadowQuerySchema = z.object({
  tenantId: z.string().min(1).max(64).optional().describe('租户 ID（查询选择器，非权限边界）'),
});

export type DeviceShadowQueryDto = z.infer<typeof DeviceShadowQuerySchema>;

/** 未指定租户时的默认归属 */
export const DEFAULT_TENANT_ID = 'default';

// ─── 设备安全凭证签发 Schema & DTO ──────────────────────────────────────────

// strict: 未知字段当前静默丢弃；收紧需评估历史设备固件是否携带额外字段
export const DeviceTokenRequestSchema = z.object({
  deviceId: DeviceIdSchema,
  deviceSecret: z.string().min(6).describe('设备预置通信密钥 (Pre-Shared Secret)'),
  // 租户不在此声明：它由服务端注册表 (IOT_DEVICE_TENANTS) 决定。
  // 旧客户端仍可传 tenantId，Zod 会静默丢弃，不影响换票。
});

export type DeviceTokenRequestDto = z.infer<typeof DeviceTokenRequestSchema>;

export class DeviceTokenResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: 'Mosquitto 认证专用 JWT 凭证' })
  token: string;

  @ApiProperty({ example: 2592000, description: '凭据有效期 (秒，默认 30 天)' })
  expiresIn: number;

  @ApiProperty({ example: 'mqtt://localhost:1883', description: 'Mosquitto Broker 连接端点' })
  brokerUrl: string;
}

// ─── 工业设备突发硬件告警事件 Schema & DTO ──────────────────────────────────────

// strict: 告警上报为设备侧载荷，保留 strip 以兼容后续固件新增字段
export const DeviceCriticalEventSchema = z.object({
  tenantId: z.string().default('default').describe('租户 ID'),
  deviceId: DeviceIdSchema.describe('设备序列号'),
  level: z.enum(['warning', 'critical']).default('warning').describe('告警等级'),
  metric: z.string().describe('告警测点或类型 (如 e_stop, over_temp, vibration_limit)'),
  value: z.number().describe('触发时测点数值'),
  threshold: z.number().describe('报警设定阈值'),
  message: z.string().describe('报警详细描述'),
  timestamp: z.number().optional().describe('事件发生时间戳 (毫秒)'),
});

export type DeviceCriticalEventDto = z.infer<typeof DeviceCriticalEventSchema>;

// ─── 设备在线/遗嘱状态变更 Schema & DTO ────────────────────────────────────────

export const DeviceStatusPayloadSchema = z.object({
  status: z.enum(['online', 'offline']).describe('设备在线状态'),
  reason: z.string().optional().describe('状态变更原因 (如 normal_boot, LWT_timeout)'),
  timestamp: z.number().optional().describe('状态变更时间戳 (毫秒)'),
});

export type DeviceStatusPayload = z.infer<typeof DeviceStatusPayloadSchema>;

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

  // 遥测字段契约由 DeviceTelemetrySchema 定义（该模块未纳入对外 Swagger 文档，此处仅作类型级说明）
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true, description: '最新遥测影子快照' })
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
