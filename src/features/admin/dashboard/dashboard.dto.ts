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
