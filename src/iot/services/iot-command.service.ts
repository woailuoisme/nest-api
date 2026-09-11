import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { delay } from 'es-toolkit';
import { IOT_EVENTS, type IotCommandExecutedEvent } from '@/common/events';
import { MqttCtx, MqttParams, MqttPayload, MqttSubscribe } from '../decorators';
import type { CommandResponseEntity } from '../dto/iot.dto';
import type { MqttMessageContext } from '../transports/interfaces/mqtt.interface';
import { MqttService } from '../transports/mqtt.service';

interface CommandMessagePayload {
  command: string;
  params?: Record<string, unknown>;
  timestamp: number;
}

/**
 * 工业设备指令下发与同步 RPC 调用服务
 *
 * 核心特性：
 * 1. 原生基于 MQTT 5.0 的 `responseTopic` 与 `correlationData`，无需引入 Redis 轮询即可完成端到端微秒级 RPC。
 * 2. 自动化超时清理与 Promise 熔断保障。
 * 3. 内置工业设备模拟响应器（Simulated PLC Agent），支持开发测试环境零硬件依赖闭环调试。
 * 4. 指令执行完成后派发领域事件 (@nestjs/event-emitter)，驱动实时广播推流与审计追溯。
 */
@Injectable()
export class IotCommandService {
  private readonly logger = new Logger(IotCommandService.name);

  constructor(
    private readonly mqttService: MqttService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 向指定工业设备下发指令并同步等待其响应 (MQTT 5.0 RPC)
   */
  async sendCommand(
    deviceId: string,
    command: string,
    params?: Record<string, unknown>,
    timeoutMs = 5000,
  ): Promise<CommandResponseEntity> {
    if (!this.mqttService.isConnected()) {
      throw new ServiceUnavailableException('MQTT 代理服务未连接或未启用，无法向设备下发指令');
    }

    const startTime = Date.now();
    const targetTopic = `devices/${deviceId}/command`;
    const payload: CommandMessagePayload = {
      command,
      params,
      timestamp: startTime,
    };

    this.logger.log(`[Command Dispatch] 下发指令 [${command}] 到设备 [${deviceId}] (超时: ${timeoutMs}ms)`);

    const rawResponse = await this.mqttService.request(targetTopic, payload, {
      timeoutMs,
      qos: 1,
      userProperties: {
        dispatchedBy: 'NestForge-IotHub',
        dispatchedAt: String(startTime),
      },
    });

    const elapsedMs = Date.now() - startTime;

    // 派发指令执行回执领域事件
    const event: IotCommandExecutedEvent = {
      deviceId,
      command,
      success: true,
      params,
      data: rawResponse,
      elapsedMs,
      timestamp: Date.now(),
    };
    this.eventEmitter.emit(IOT_EVENTS.COMMAND_EXECUTED, event);

    return {
      success: true,
      deviceId,
      command,
      data: rawResponse,
      elapsedMs,
    };
  }

  /**
   * 模拟工业设备响应端 (Simulated PLC Listener)
   *
   * 监听所有设备的下发指令。若接收到的请求携带 MQTT 5.0 `responseTopic` 与 `correlationData`，
   * 则模拟执行该工业动作并在 50ms 内原路回执，验证端到端 RPC 闭环。
   */
  @MqttSubscribe('devices/:deviceId/command', { qos: 1 })
  async handleMockDeviceCommand(
    @MqttPayload() payload: CommandMessagePayload,
    @MqttParams('deviceId') deviceId: string,
    @MqttCtx() context: MqttMessageContext,
  ): Promise<void> {
    // 仅在显式开启模拟设备或单测环境下响应，杜绝在生产中抢答真实工业 PLC 指令
    const isSimulationEnabled = process.env.IOT_SIMULATED_DEVICE_ENABLED === 'true' || process.env.NODE_ENV === 'test';
    if (!isSimulationEnabled) {
      return;
    }

    this.logger.debug(
      `[Simulated Device] 设备 [${deviceId}] 收到指令 [${payload.command}]，准备执行 (correlationId: ${context.correlationData?.toString()})`,
    );

    if (context.responseTopic && context.correlationData) {
      // 模拟电机或 PLC 控制器硬件执行微延迟 (20ms)
      await delay(20);

      const ackResult = {
        ack: true,
        code: 200,
        deviceId,
        executedCommand: payload.command,
        appliedParams: payload.params ?? {},
        deviceStatus: 'running',
        completedAt: Date.now(),
      };

      await this.mqttService.publish(context.responseTopic, ackResult, {
        qos: 1,
        correlationData: context.correlationData,
        userProperties: {
          simulatedBy: 'Virtual-Industrial-PLC',
        },
      });

      this.logger.debug(`[Simulated Device] 设备 [${deviceId}] 已向 [${context.responseTopic}] 回送执行结果`);
    }
  }
}
