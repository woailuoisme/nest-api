import { MQTT_PARAM_METADATA } from '../interfaces/mqtt.interface';

export interface MqttParamBinding {
  index: number;
  type: 'payload' | 'params' | 'context';
  paramName?: string;
}

function registerParamMetadata(target: object, propertyKey: string | symbol, binding: MqttParamBinding) {
  const existing: MqttParamBinding[] = Reflect.getMetadata(MQTT_PARAM_METADATA, target, propertyKey) || [];
  existing.push(binding);
  Reflect.defineMetadata(MQTT_PARAM_METADATA, existing, target, propertyKey);
}

/**
 * 注入已反序列化的 Payload（若为 JSON 自动解析为对象，否则为原始 Buffer/字符串）
 */
export function MqttPayload(): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      registerParamMetadata(target, propertyKey, {
        index: parameterIndex,
        type: 'payload',
      });
    }
  };
}

/**
 * 注入从主题模式提取的参数字典，或指定提取某个命名参数
 * 示例：@MqttParams() params: Record<string, string> 或 @MqttParams('deviceId') deviceId: string
 */
export function MqttParams(paramName?: string): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      registerParamMetadata(target, propertyKey, {
        index: parameterIndex,
        type: 'params',
        paramName,
      });
    }
  };
}

/**
 * 注入包含原始主题、解析参数及 MQTT 5.0 Packet (含 UserProperties 等) 的上下文
 */
export function MqttCtx(): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      registerParamMetadata(target, propertyKey, {
        index: parameterIndex,
        type: 'context',
      });
    }
  };
}

export const MqttContextDecorator = MqttCtx;
