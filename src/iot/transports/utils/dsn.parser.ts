import { randomUUID } from 'node:crypto';

import type { MqttOptions } from '../interfaces/mqtt.interface';

/**
 * 解析 MQTT DSN 字符串为标准 MqttOptions 连接配置
 *
 * 支持协议：mqtt://, mqtts://, tcp://, ssl://, ws://, wss://
 * 示例：
 *   mqtt://admin:secret@localhost:1883?clientId=nest-api&clean=true&keepalive=60
 */
export function parseMqttDsn(dsn: string): MqttOptions {
  if (!dsn || typeof dsn !== 'string') {
    throw new Error('MQTT DSN 不能为空');
  }

  const trimmed = dsn.trim();
  const normalized = trimmed.replace(/^tcp:\/\//i, 'mqtt://').replace(/^ssl:\/\//i, 'mqtts://');

  let url: URL;
  try {
    url = new URL(normalized);
  } catch (error) {
    throw new Error(`无效的 MQTT DSN 格式: ${trimmed} (${(error as Error).message})`);
  }

  const rawProtocol = url.protocol.replace(/:$/, '').toLowerCase();
  const validProtocols = ['mqtt', 'mqtts', 'ws', 'wss'];
  if (!validProtocols.includes(rawProtocol)) {
    throw new Error(`不支持的 MQTT 协议方案 [${rawProtocol}]，仅支持: mqtt, mqtts, ws, wss`);
  }

  const protocol = rawProtocol as 'mqtt' | 'mqtts' | 'ws' | 'wss';

  const defaultPort = protocol === 'mqtts' ? 8883 : protocol === 'ws' ? 9001 : protocol === 'wss' ? 9002 : 1883;
  const port = url.port ? Number.parseInt(url.port, 10) : defaultPort;

  const search = url.searchParams;

  const clientId = search.get('clientId') || search.get('client_id') || `nestforge-${randomUUID().slice(0, 8)}`;
  const clean = search.has('clean') ? search.get('clean') === 'true' : true;
  const keepalive = search.has('keepalive') ? Number.parseInt(search.get('keepalive') ?? '60', 10) : 60;
  const reconnectPeriod = search.has('reconnectPeriod')
    ? Number.parseInt(search.get('reconnectPeriod') ?? '1000', 10)
    : 1000;
  const connectTimeout = search.has('connectTimeout')
    ? Number.parseInt(search.get('connectTimeout') ?? '30000', 10)
    : 30000;

  const options: MqttOptions = {
    url: trimmed,
    protocol,
    host: url.hostname,
    port,
    clientId,
    clean,
    keepalive,
    protocolVersion: 5,
    reconnectPeriod,
    connectTimeout,
  };

  if (url.username) {
    options.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }
  if (url.pathname && url.pathname !== '/') {
    options.path = url.pathname;
  }

  return options;
}

/**
 * 推导 Broker 连接地址：优先复用 DSN 原串，其次由协议/主机/端口拼装
 */
export function resolveMqttBrokerUrl(options?: MqttOptions | null): string {
  if (!options) {
    return 'mqtt://localhost:1883';
  }
  return options.url || `${options.protocol}://${options.host}:${options.port}`;
}
