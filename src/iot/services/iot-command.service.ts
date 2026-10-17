import { randomUUID } from 'node:crypto';

import { Injectable, Logger, RequestTimeoutException, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { delay } from 'es-toolkit';

import { IOT_EVENTS, type IotCommandExecutedEvent } from '@/common/events';

import { MqttCtx, MqttParams, MqttPayload, MqttSubscribe } from '../decorators';
import type { CommandResponseEntity } from '../dto/iot.dto';
import type { MqttMessageContext } from '../transports/interfaces/mqtt.interface';
import { MqttService } from '../transports/mqtt.service';

/** 指令审计历史内存保留上限（保留最新 N 条） */
export const MAX_COMMAND_HISTORY = 500;

interface CommandMessagePayload {
  command: string;
  params?: Record<string, unknown>;
  timestamp: number;
}

export interface CommandAuditRecord {
  id: string;
  deviceId: string;
  command: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  params?: Record<string, unknown>;
  data?: unknown;
  elapsedMs?: number;
  dispatchedAt: number;
}

/**
 * 工业设备指令下发与同步 RPC 调用服务
 *
 * 核心特性：
 * 1. 原生基于 MQTT 5.0 的 `responseTopic` 与 `correlationData`，无需引入 Redis 轮询即可完成端到端微秒级 RPC。
 * 2. 工业指令二阶段状态机与审计追踪 (PENDING -> SUCCESS/FAILED/TIMEOUT)。
 * 3. 自动化超时清理与 Promise 熔断保障。
 * 4. 内置工业设备模拟响应器（Simulated PLC Agent），支持开发测试环境零硬件依赖闭环调试。
 * 5. 指令执行完成后派发领域事件 (@nestjs/event-emitter)，驱动实时广播推流与审计追溯。
 */
@Injectable()
export class IotCommandService {
  private readonly logger = new Logger(IotCommandService.name);

  /** 最近指令执行审计记录缓存 (保留最新 MAX_COMMAND_HISTORY 条) */
  private readonly commandHistory: CommandAuditRecord[] = [];

  constructor(
    private readonly mqttService: MqttService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 获取指定设备或全量指令执行审计历史（最新在前）
   */
  getCommandHistory(deviceId?: string): CommandAuditRecord[] {
    const records = deviceId ? this.commandHistory.filter((c) => c.deviceId === deviceId) : this.commandHistory;
    return records.toReversed();
  }

  /**
   * 向指定工业设备下发指令并同步等待其响应 (二阶段状态机 + MQTT 5.0 RPC)
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

    // 1. 状态机阶段 1: 创建 PENDING 审计记录
    const auditRecord: CommandAuditRecord = {
      id: randomUUID(),
      deviceId,
      command,
      status: 'PENDING',
      params,
      dispatchedAt: startTime,
    };
    // 尾部追加保证高频指令下写入恒为 O(1)（unshift 每次都会整体搬移元素）
    this.commandHistory.push(auditRecord);
    if (this.commandHistory.length > MAX_COMMAND_HISTORY) {
      this.commandHistory.splice(0, this.commandHistory.length - MAX_COMMAND_HISTORY);
    }

    this.logger.log(`[Command Dispatch] 下发指令 [${command}] 到设备 [${deviceId}] (超时: ${timeoutMs}ms)`);

    try {
      const rawResponse = await this.mqttService.request(targetTopic, payload, {
        timeoutMs,
        qos: 1,
        userProperties: {
          dispatchedBy: 'NestForge-IotHub',
          dispatchedAt: String(startTime),
        },
      });

      const elapsedMs = Date.now() - startTime;

      // 2. 状态机阶段 2: 响应成功更新为 SUCCESS
      auditRecord.status = 'SUCCESS';
      auditRecord.data = rawResponse;
      auditRecord.elapsedMs = elapsedMs;

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
    } catch (error) {
      // 3. 状态机阶段 2 (异常分支): 更新为 TIMEOUT 或 FAILED 并记录耗时
      auditRecord.status = error instanceof RequestTimeoutException ? 'TIMEOUT' : 'FAILED';
      auditRecord.elapsedMs = Date.now() - startTime;
      throw error;
    }
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

    // 未携带 MQTT 5.0 应答元数据的广播指令无需回执
    const { responseTopic, correlationData } = context;
    if (!responseTopic || !correlationData) {
      return;
    }

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

    await this.mqttService.publish(responseTopic, ackResult, {
      qos: 1,
      correlationData,
      userProperties: {
        simulatedBy: 'Virtual-Industrial-PLC',
      },
    });

    this.logger.debug(`[Simulated Device] 设备 [${deviceId}] 已向 [${responseTopic}] 回送执行结果`);
  }
}
