import type { IClientOptions, IPublishPacket, MqttClient } from 'mqtt';

export const MQTT_CLIENT_TOKEN = Symbol('MQTT_CLIENT_TOKEN');
export const MQTT_OPTIONS_TOKEN = Symbol('MQTT_OPTIONS_TOKEN');
export const MQTT_SUBSCRIBE_METADATA = 'MQTT_SUBSCRIBE_METADATA';
export const MQTT_PARAM_METADATA = 'MQTT_PARAM_METADATA';

/**
 * MQTT 5.0 连接配置接口
 */
export interface MqttOptions extends Partial<IClientOptions> {
  url?: string;
  protocol?: 'mqtt' | 'mqtts' | 'tcp' | 'ssl' | 'ws' | 'wss';
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  clientId?: string;
  clean?: boolean;
  keepalive?: number;
  protocolVersion?: 5;
  reconnectPeriod?: number;
  connectTimeout?: number;
}

/**
 * @MqttSubscribe 装饰器配置选项
 */
export interface MqttSubscribeOptions {
  /** 消息服务质量等级 (0: At most once, 1: At least once, 2: Exactly once) */
  qos?: 0 | 1 | 2;
  /**
   * MQTT 5.0 共享订阅分组 ($share/{group}/{topic})
   * 配置后，Mosquitto Broker 会在该分组的所有消费者 Pod 间轮询分发，支持水平伸缩
   */
  sharedGroup?: string;
  /** No Local: 若为 true，Broker 不向发送该消息的客户端回发此消息 */
  nl?: boolean;
  /** Retain as Published */
  rap?: boolean;
  /** Retain Handling (0: 发送保留消息, 1: 仅在新订阅时发送, 2: 不发送) */
  rh?: 0 | 1 | 2;
}

/**
 * MQTT 5.0 消息发布增强选项
 */
export interface MqttPublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
  dup?: boolean;
  /** MQTT 5.0 用户属性 (类似 HTTP Header 元数据键值对) */
  userProperties?: Record<string, string | string[]>;
  /** MQTT 5.0 请求-响应模式：指定应答回传主题 */
  responseTopic?: string;
  /** MQTT 5.0 请求-响应模式：关联标识 (Buffer 或字符串) */
  correlationData?: Buffer | string;
  /** 消息过期间隔 (秒) */
  messageExpiryInterval?: number;
  /** 主题别名 */
  topicAlias?: number;
}

/**
 * MqttService.request RPC 同步控制下发选项
 */
export interface MqttRequestOptions {
  /** 等待设备响应超时毫秒数，默认 5000ms */
  timeoutMs?: number;
  /** 等待设备响应超时毫秒数别名 */
  timeout?: number;
  /** 消息服务质量等级，默认 1 */
  qos?: 0 | 1 | 2;
  /** MQTT 5.0 用户属性 */
  userProperties?: Record<string, string | string[]>;
  /** 指令过期间隔 (秒) */
  messageExpiryInterval?: number;
}

/**
 * 接收消息时的元数据上下文
 */
export interface MqttMessageContext {
  /** 实际触发的完整主题 */
  topic: string;
  /** 从命名路由提取的主题参数 (如 devices/:tenantId/:deviceId -> { tenantId, deviceId }) */
  params: Record<string, string>;
  /** 原始 MQTT 5.0 数据包属性 */
  packet: IPublishPacket;
  /** 消息服务质量等级 (快捷访问) */
  qos?: number;
  /** MQTT 5.0 请求-响应模式：应答回传主题 */
  responseTopic?: string;
  /** MQTT 5.0 请求-响应模式：关联标识 */
  correlationData?: Buffer;
  /** MQTT 5.0 用户属性 */
  userProperties?: Record<string, string | string[]>;
}

export type MqttContext = MqttMessageContext;

/**
 * 主题处理器元数据包装
 */
export interface MqttHandlerMetadata {
  pattern: string;
  effectivePattern: string;
  options: MqttSubscribeOptions;
  target: object;
  methodName: string;
  paramMetadata?: Array<{
    index: number;
    type: 'payload' | 'params' | 'context';
    paramName?: string;
  }>;
}

export type { IPublishPacket, MqttClient };
