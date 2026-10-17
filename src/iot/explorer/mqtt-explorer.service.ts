import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { IPublishPacket } from 'mqtt';

import type { MqttParamBinding } from '../decorators/mqtt-params.decorator';
import {
  MQTT_PARAM_METADATA,
  MQTT_SUBSCRIBE_METADATA,
  type MqttMessageContext,
  type MqttSubscribeMetadata,
  type MqttSubscribeOptions,
} from '../transports/interfaces/mqtt.interface';
import { MqttService } from '../transports/mqtt.service';
import { matchTopic } from '../transports/utils/topic-matcher';

interface RegisteredMqttRoute {
  pattern: string;
  options: MqttSubscribeOptions;
  instance: Record<string, unknown>;
  methodName: string;
  paramBindings?: MqttParamBinding[];
}

/** 反序列化 MQTT 报文：合法 JSON 解析为对象，否则回退为 UTF-8 字符串 */
function parseMqttPayload(rawPayload: Buffer): unknown {
  const text = rawPayload.toString('utf-8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

@Injectable()
export class MqttExplorerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MqttExplorerService.name);
  private readonly routes: RegisteredMqttRoute[] = [];

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly mqttService: MqttService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const client = this.mqttService.getClient();
    if (!client) {
      return;
    }

    this.explore();
    await this.subscribeAll();
    this.listen();
  }

  /**
   * 扫描所有 Provider 中带有 @MqttSubscribe 装饰器的方法并完成注册
   */
  explore(): void {
    const providers = this.discoveryService.getProviders();

    for (const wrapper of providers) {
      const { instance } = wrapper;
      if (!instance || typeof instance !== 'object') {
        continue;
      }

      const prototype = Object.getPrototypeOf(instance);
      if (!prototype) {
        continue;
      }

      const methodNames = this.metadataScanner.getAllMethodNames(prototype);

      for (const methodName of methodNames) {
        const targetCallback = (instance as Record<string, unknown>)[methodName];
        if (typeof targetCallback !== 'function') {
          continue;
        }

        const metadata = this.reflector.get<MqttSubscribeMetadata | undefined>(MQTT_SUBSCRIBE_METADATA, targetCallback);
        if (!metadata) {
          continue;
        }

        const paramBindings = Reflect.getMetadata(MQTT_PARAM_METADATA, prototype, methodName) as
          | MqttParamBinding[]
          | undefined;

        this.routes.push({
          pattern: metadata.pattern,
          options: metadata.options,
          instance: instance as Record<string, unknown>,
          methodName,
          paramBindings,
        });

        this.logger.log(`发现 MQTT 主题订阅: [${metadata.pattern}] -> ${instance.constructor.name}.${methodName}()`);
      }
    }
  }

  /**
   * 批量向 Mosquitto Broker 发起主题订阅
   */
  async subscribeAll(): Promise<void> {
    for (const route of this.routes) {
      await this.mqttService.subscribe(route.pattern, route.options);
    }
  }

  /**
   * 启动全局流入消息路由分发监听
   */
  listen(): void {
    const client = this.mqttService.getClient();
    if (!client) return;

    client.on('message', async (topic: string, rawPayload: Buffer, packet: IPublishPacket) => {
      // 若是当前 Pod 的专属 RPC 响应主题，MqttService 已内置拦截处理，跳过业务路由
      if (topic === this.mqttService.getReplyTopic()) {
        return;
      }

      await this.dispatch(topic, rawPayload, packet);
    });
  }

  /**
   * 将接收到的 MQTT 消息精准分发至匹配的业务方法
   */
  async dispatch(topic: string, rawPayload: Buffer, packet: IPublishPacket): Promise<void> {
    // Payload 反序列化与匹配的路由无关，单条消息仅解析一次
    const payload = parseMqttPayload(rawPayload);

    for (const route of this.routes) {
      const matchResult = matchTopic(route.pattern, topic);
      if (!matchResult.matched) {
        continue;
      }

      const context: MqttMessageContext = {
        topic,
        params: matchResult.params,
        packet,
        qos: packet.qos,
        responseTopic: packet.properties?.responseTopic,
        correlationData: packet.properties?.correlationData as Buffer | undefined,
        userProperties: packet.properties?.userProperties as Record<string, string | string[]> | undefined,
      };

      try {
        const targetMethod = route.instance[route.methodName] as (...fnArgs: unknown[]) => Promise<unknown> | unknown;
        await targetMethod.apply(route.instance, this.resolveArgs(route, payload, matchResult.params, context));
      } catch (error) {
        this.logger.error(
          `执行 MQTT 主题 [${topic}] 业务处理器 ${route.instance.constructor.name}.${route.methodName}() 发生异常: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    }
  }

  getRegisteredRoutes(): RegisteredMqttRoute[] {
    return [...this.routes];
  }

  /**
   * 内部方法：按方法上声明的 @MqttPayload / @MqttParams / @MqttCtx 顺序组装实参
   * 未声明任何参数装饰器时，遵循默认入参约定 (payload, context)
   */
  private resolveArgs(
    route: RegisteredMqttRoute,
    payload: unknown,
    params: Record<string, string>,
    context: MqttMessageContext,
  ): unknown[] {
    const bindings = route.paramBindings;
    if (!bindings?.length) {
      return [payload, context];
    }

    const args: unknown[] = new Array(Math.max(...bindings.map((binding) => binding.index)) + 1);
    for (const binding of bindings) {
      if (binding.type === 'payload') {
        args[binding.index] = payload;
      } else if (binding.type === 'params') {
        args[binding.index] = binding.paramName ? params[binding.paramName] : params;
      } else {
        args[binding.index] = context;
      }
    }
    return args;
  }
}
