import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { IPublishPacket } from 'mqtt';
import type { MqttParamBinding } from '../decorators/mqtt-params.decorator';
import {
  MQTT_PARAM_METADATA,
  MQTT_SUBSCRIBE_METADATA,
  type MqttMessageContext,
  type MqttSubscribeOptions,
} from '../interfaces/mqtt.interface';
import { MqttService } from '../mqtt.service';
import { matchTopic } from '../utils/topic-matcher';

interface RegisteredMqttRoute {
  pattern: string;
  options: MqttSubscribeOptions;
  instance: Record<string, unknown>;
  methodName: string;
  paramBindings?: MqttParamBinding[];
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

        const metadata = this.reflector.get<
          | {
              pattern: string;
              options: MqttSubscribeOptions;
            }
          | undefined
        >(MQTT_SUBSCRIBE_METADATA, targetCallback);

        if (!metadata) {
          continue;
        }

        const paramBindings =
          (Reflect.getMetadata(MQTT_PARAM_METADATA, prototype, methodName) as MqttParamBinding[] | undefined) ||
          undefined;

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
    for (const route of this.routes) {
      const matchResult = matchTopic(route.pattern, topic);
      if (!matchResult.matched) {
        continue;
      }

      // 解构/反序列化 Payload
      let payload: unknown;
      const strPayload = rawPayload.toString('utf-8');
      try {
        payload = JSON.parse(strPayload);
      } catch {
        payload = strPayload;
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

      // 组装参数
      let args: unknown[];
      if (route.paramBindings && route.paramBindings.length > 0) {
        const maxIndex = Math.max(...route.paramBindings.map((b) => b.index));
        args = new Array(maxIndex + 1);

        for (const binding of route.paramBindings) {
          if (binding.type === 'payload') {
            args[binding.index] = payload;
          } else if (binding.type === 'params') {
            args[binding.index] = binding.paramName ? matchResult.params[binding.paramName] : matchResult.params;
          } else if (binding.type === 'context') {
            args[binding.index] = context;
          }
        }
      } else {
        // 未声明具体参数装饰器时的默认入参约定: (payload, context)
        args = [payload, context];
      }

      try {
        const targetMethod = route.instance[route.methodName] as (...fnArgs: unknown[]) => Promise<unknown> | unknown;
        await targetMethod.apply(route.instance, args);
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
}
