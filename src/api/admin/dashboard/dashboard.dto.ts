import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MetricChannelSchema = z.enum(['system', 'business', 'alerts']);
export type MetricChannel = z.infer<typeof MetricChannelSchema>;

/** 客户端订阅/退订频道统一请求 DTO */
export const ChannelSubscriptionSchema = z.object({
  channel: MetricChannelSchema.describe('监控频道：system | business | alerts'),
});

export class ChannelSubscriptionDto extends createZodDto(ChannelSubscriptionSchema) {}
export const SubscribeChannelSchema = ChannelSubscriptionSchema;
export const UnsubscribeChannelSchema = ChannelSubscriptionSchema;
export class SubscribeChannelDto extends ChannelSubscriptionDto {}
export class UnsubscribeChannelDto extends ChannelSubscriptionDto {}

/** 系统指标快照 */
export interface SystemMetricPayload {
  channel: 'system';
  timestamp: number;
  memory: {
    rssMb: number;
    heapTotalMb: number;
    heapUsedMb: number;
  };
  uptimeSeconds: number;
  activeSockets: number;
}

/** 业务指标快照 */
export interface BusinessMetricPayload {
  channel: 'business';
  timestamp: number;
  metric: string;
  value: number;
  tags?: Record<string, string>;
}

/** 告警通知快照 */
export interface AlertMetricPayload {
  channel: 'alerts';
  timestamp: number;
  level: 'info' | 'warn' | 'critical';
  title: string;
  message: string;
}

export type DashboardMetricPayload = SystemMetricPayload | BusinessMetricPayload | AlertMetricPayload;
