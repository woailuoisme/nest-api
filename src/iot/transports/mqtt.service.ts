import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
  RequestTimeoutException,
} from '@nestjs/common';
import { isNotNil, pickBy } from 'es-toolkit';
import type { IClientPublishOptions, IPublishPacket, MqttClient } from 'mqtt';

import {
  MQTT_CLIENT_TOKEN,
  MQTT_OPTIONS_TOKEN,
  type MqttOptions,
  type MqttPublishOptions,
  type MqttRequestOptions,
  type MqttSubscribeOptions,
} from './interfaces/mqtt.interface';
import { resolveMqttBrokerUrl } from './utils/dsn.parser';
import { toMqttTopic } from './utils/topic-matcher';

interface PendingRpcRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
}

/** 将 correlationData 归一化为 Buffer（MQTT 5.0 协议字段要求二进制，空值视为未声明） */
function toCorrelationData(value?: Buffer | string): Buffer | undefined {
  if (!value) {
    return undefined;
  }
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

@Injectable()
export class MqttService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MqttService.name);

  /** 当前 Pod 唯一标识，用于隔离 RPC 回复通道 */
  private readonly podId = randomUUID().slice(0, 8);
  /** 当前 Pod 专用的 MQTT 5.0 RPC 回复主题 */
  private readonly replyTopic = `app/rpc/${this.podId}/reply`;

  /** 挂起中的 RPC 请求集合 */
  private readonly pendingRpcRequests = new Map<string, PendingRpcRequest>();

  private isClientConnected = false;
  private reconnectAttempts = 0;

  constructor(
    @Optional()
    @Inject(MQTT_CLIENT_TOKEN)
    private readonly client: MqttClient | null,
    @Optional()
    @Inject(MQTT_OPTIONS_TOKEN)
    private readonly options: MqttOptions | null,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.client) {
      this.logger.debug('MQTT 服务未配置 MQTT_URL，客户端处于未激活 (Inactive) 状态');
      return;
    }

    this.setupClientEvents();
    await this.subscribeToReplyTopic();
  }

  async onApplicationShutdown(): Promise<void> {
    // 清理所有尚未应答的 RPC 请求
    for (const [correlationId, pending] of this.pendingRpcRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`服务正在停机，RPC 请求已取消: ${correlationId}`));
    }
    this.pendingRpcRequests.clear();

    if (this.client?.connected) {
      this.logger.log('正在优雅断开 MQTT 客户端连接...');
      await new Promise<void>((resolve) => {
        this.client?.end(false, {}, () => resolve());
      });
      this.isClientConnected = false;
    }
  }

  /**
   * 客户端连接健康状态
   */
  isConnected(): boolean {
    return this.client !== null && this.isClientConnected;
  }

  /**
   * 获取重连尝试计数
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * 获取当前 Pod 专属响应主题
   */
  getReplyTopic(): string {
    return this.replyTopic;
  }

  /**
   * 获取底层 MQTT Client 实例
   */
  getClient(): MqttClient | null {
    return this.client;
  }

  /**
   * 获取当前生效的 MQTT Broker 终端地址
   */
  getBrokerUrl(): string {
    return resolveMqttBrokerUrl(this.options);
  }

  /**
   * 发布消息到指定主题（支持 MQTT 5.0 用户属性与请求-响应元数据）
   */
  async publish(topic: string, message: string | Buffer | object, options: MqttPublishOptions = {}): Promise<void> {
    const { client } = this;
    if (!client) {
      this.logger.warn(`MQTT 客户端未激活，跳过向 [${topic}] 发布消息`);
      return;
    }

    let payload: Buffer | string;
    if (Buffer.isBuffer(message)) {
      payload = message;
    } else if (typeof message === 'object') {
      payload = JSON.stringify(message);
    } else {
      payload = String(message);
    }

    const publishOptions: IClientPublishOptions = {
      qos: options.qos ?? 0,
      retain: options.retain ?? false,
      dup: options.dup ?? false,
    };

    // 构建 MQTT 5.0 协议属性，自动剔除未声明的字段
    const properties = pickBy(
      {
        userProperties: options.userProperties,
        responseTopic: options.responseTopic,
        correlationData: toCorrelationData(options.correlationData),
        messageExpiryInterval: options.messageExpiryInterval,
        topicAlias: options.topicAlias,
      },
      isNotNil,
    );

    if (Object.keys(properties).length > 0) {
      publishOptions.properties = properties;
    }

    return new Promise((resolve, reject) => {
      client.publish(topic, payload, publishOptions, (error) => {
        if (error) {
          this.logger.error(`向主题 [${topic}] 发送消息失败: ${error.message}`);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 工业设备 RPC 双向同步控制下发（基于 MQTT 5.0 Response Topic 与 Correlation Data）
   */
  async request<TResponse = unknown>(
    targetTopic: string,
    command: string | Buffer | object,
    options: MqttRequestOptions = {},
  ): Promise<TResponse> {
    if (!this.client) {
      throw new Error('MQTT 客户端未激活，无法发起设备 RPC 控制指令');
    }

    const correlationId = randomUUID();
    const timeoutMs = options.timeoutMs ?? 5000;

    return new Promise<TResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpcRequests.delete(correlationId);
        reject(
          new RequestTimeoutException(
            `等待设备控制应答超时 (${timeoutMs}ms): [${targetTopic}] (correlationId: ${correlationId})`,
          ),
        );
      }, timeoutMs);

      this.pendingRpcRequests.set(correlationId, {
        resolve: resolve as (val: unknown) => void,
        reject,
        timer,
      });

      // 下发指令，并附带当前 Pod 的专属回复主题与 correlationData
      this.publish(targetTopic, command, {
        qos: options.qos ?? 1,
        responseTopic: this.replyTopic,
        correlationData: Buffer.from(correlationId),
        userProperties: options.userProperties,
        messageExpiryInterval: options.messageExpiryInterval,
      }).catch((err) => {
        clearTimeout(timer);
        this.pendingRpcRequests.delete(correlationId);
        reject(err);
      });
    });
  }

  /**
   * 订阅指定主题（支持 MQTT 5.0 共享订阅 $share/{group}/{topic}）
   */
  async subscribe(pattern: string, options: MqttSubscribeOptions = {}): Promise<void> {
    const { client } = this;
    if (!client) {
      return;
    }

    const effectiveTopic = toMqttTopic(pattern, options.sharedGroup);

    return new Promise((resolve, reject) => {
      client.subscribe(
        effectiveTopic,
        {
          qos: options.qos ?? 0,
          nl: options.nl,
          rap: options.rap,
          rh: options.rh,
        },
        (error) => {
          if (error) {
            this.logger.error(`订阅主题 [${effectiveTopic}] 失败: ${error.message}`);
            reject(error);
          } else {
            this.logger.log(`成功订阅 MQTT 主题: [${effectiveTopic}] (QoS: ${options.qos ?? 0})`);
            resolve();
          }
        },
      );
    });
  }

  /**
   * 取消订阅指定主题
   */
  async unsubscribe(pattern: string, sharedGroup?: string): Promise<void> {
    const { client } = this;
    if (!client) {
      return;
    }

    const effectiveTopic = toMqttTopic(pattern, sharedGroup);

    return new Promise((resolve, reject) => {
      client.unsubscribe(effectiveTopic, {}, (error) => {
        if (error) {
          this.logger.error(`取消订阅主题 [${effectiveTopic}] 失败: ${error.message}`);
          reject(error);
        } else {
          this.logger.log(`已取消订阅 MQTT 主题: [${effectiveTopic}]`);
          resolve();
        }
      });
    });
  }

  /**
   * 内部方法：监听客户端生命周期事件
   */
  private setupClientEvents(): void {
    const { client } = this;
    if (!client) return;

    client.on('connect', () => {
      this.isClientConnected = true;
      this.reconnectAttempts = 0;
      this.logger.log(
        `MQTT 5.0 客户端已成功连接至 Mosquitto Broker [${this.options?.host}:${this.options?.port}] (ClientId: ${this.options?.clientId})`,
      );
    });

    client.on('reconnect', () => {
      this.reconnectAttempts++;
      this.logger.warn(`MQTT 客户端正在尝试重连 Broker (第 ${this.reconnectAttempts} 次)...`);
    });

    client.on('close', () => {
      this.isClientConnected = false;
      this.logger.warn('MQTT 客户端与 Broker 的连接已断开');
    });

    client.on('error', (error) => {
      this.logger.error(`MQTT 客户端异常: ${error.message}`, error.stack);
    });

    // 监听所有流入的消息，优先拦截当前 Pod 的专属 RPC 回复
    client.on('message', (topic: string, payload: Buffer, packet: IPublishPacket) => {
      if (topic === this.replyTopic) {
        this.handleRpcReplyMessage(payload, packet);
      }
    });
  }

  /**
   * 内部方法：订阅当前 Pod 专属响应主题
   */
  private async subscribeToReplyTopic(): Promise<void> {
    const { client } = this;
    if (!client) return;

    await new Promise<void>((resolve) => {
      client.subscribe(this.replyTopic, { qos: 1 }, (err) => {
        if (err) {
          this.logger.error(`订阅专属 RPC 回复主题 [${this.replyTopic}] 失败: ${err.message}`);
        } else {
          this.logger.log(`已就绪专属 RPC 回复通道: [${this.replyTopic}]`);
        }
        resolve();
      });
    });
  }

  /**
   * 内部方法：处理收到的 RPC 应答报文
   */
  private handleRpcReplyMessage(payload: Buffer, packet: IPublishPacket): void {
    const correlationData = packet.properties?.correlationData;
    if (!correlationData) {
      this.logger.warn(`收到 RPC 应答报文但缺失 correlationData，忽略处理`);
      return;
    }

    const correlationId = Buffer.isBuffer(correlationData)
      ? correlationData.toString('utf-8')
      : String(correlationData);

    const pending = this.pendingRpcRequests.get(correlationId);
    if (!pending) {
      this.logger.warn(`收到未知的 RPC 应答或请求已超时: ${correlationId}`);
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRpcRequests.delete(correlationId);

    try {
      const parsed = JSON.parse(payload.toString('utf-8'));
      pending.resolve(parsed);
    } catch {
      // 若不是有效 JSON，返回原始 Buffer 或文本字符串
      const str = payload.toString('utf-8');
      pending.resolve(str);
    }
  }
}
