# 工业级物联网 MQTT 5.0 架构与产品接入指南

> 本文档面向工业物联网（IIoT）系统架构师、边缘网关与嵌入式固件开发团队、全端大屏开发团队以及平台运维团队，作为工业产品接入 NestForge 工业底座的**标准协议契约、工业物模型规范、主题拓扑体系、双向 RPC 通信范式以及安全加固工程标准**。

---

## 1. 工业物联网顶层架构与 ISA-95 映射 (IIoT Architecture)

在工业 4.0 与智能制造体系中，NestForge 作为云端制造运营核心（MOM/MES/SCADA 赋能平台），遵循 **ISA-95 / Purdue 工业自动化五层模型**，构建了以 **MQTT 5.0** 为中枢神经的高并发、低延迟工业连接架构：

```mermaid
flowchart TD
    subgraph L0_L1["Level 0~1: 现场设备与执行层 (Sensors & Actuators)"]
        Sensors["传感器 (温湿度/震动/压力)"]
        PLCs["现场 PLC (西门子 S7 / 三菱 / 欧姆龙 / 汇川)"]
        Robots["工业机器人 / CNC 数控机床 / AGV 小车"]
    end

    subgraph L2_Edge["Level 2: 边缘计算与协议网关 (Industrial Edge Gateway)"]
        EdgeApp["边缘采集程序 (Modbus/OPC-UA/CAN ➔ MQTT 5.0)"]
        EdgeBuffer["边缘断网续传缓存 (DuckDB / SQLite / Buffer)"]
        EdgeSecurity["硬件加密芯片 (TPM 2.0 / SE 安全单元)"]
    end

    subgraph L3_Broker["工业级分布式消息集群 (Enterprise MQTT Broker)"]
        direction TB
        BrokerCluster["EMQX Enterprise / HiveMQ 集群 (TLS 8883)"]
        ACL["动态 ACL 鉴权引擎 (JWT / X.509 mTLS)"]
        RuleEngine["数据分流与持久化桥接"]
    end

    subgraph L4_Cloud["Level 3~4: NestForge 核心工业服务底座 (NestJS Core)"]
        direction TB
        MqttClientModule["MqttModule (NestForge MQTT 5.0 Engine)"]
        SharedSubs["$share 共享订阅集群负载均衡"]
        RpcEngine["MQTT 5.0 RPC 协调器 (responseTopic/correlationData)"]
        DeviceShadow["数字影子 (Device Shadow Memory/Timescale)"]
        EventBus["@nestjs/event-emitter 领域事件总线"]
    end

    subgraph Upper_Apps["制造协同与实时呈现 (Presentation Layer)"]
        Centrifugo["Centrifugo 实时推流引擎"]
        Dashboard["工控 SCADA 大屏 / 产线电子看板 (WebSocket)"]
        ERP["ERP / 生产调度 / 质量追溯系统"]
    end

    L0_L1 -->|"现场工业总线 (Modbus, OPC-UA, CANopen)"| L2_Edge
    L2_Edge -->|"MQTT 5.0 over TLS (MQTTS 8883)"| L3_Broker
    L3_Broker -->|"$share 共享订阅 / 毫秒级 RPC"| L4_Cloud
    L4_Cloud -->|"领域事件下发 (iot.telemetry.received)"| EventBus
    EventBus -->|"发布到实时频道"| Centrifugo
    Centrifugo -->|"WebSocket 广播推流"| Dashboard
    L4_Cloud -->|"MES 业务流转"| ERP
    L4_Cloud -.->|"反向微秒级控制指令 (RPC Request)"| L3_Broker
    L3_Broker -.->|"控制下发到特定设备"| L2_Edge
    L2_Edge -.->|"驱动现场动作"| L0_L1
```

### 1.1 核心设计哲学

1. **协议层与传输层彻底解耦**：现场总线繁多（Modbus RTU/TCP、OPC UA、Profinet、EtherCAT），通过边缘网关就地将数据清洗、对齐并转换为标准的 **MQTT 5.0 JSON / Protobuf** 结构，阻断现场总线抖动对云端业务的冲击。
2. **端云双向无锁响应 (Zero-Polling RPC)**：全面摈弃传统基于 HTTP 轮询或 Redis 中转的设备下发状态同步机制，利用 MQTT 5.0 原生的 `responseTopic` 与 `correlationData`，实现云端对现场设备的**微秒级同步控制与确定性闭环**。
3. **高可用弹性吞吐 ($share)**：针对百万级工业测点每秒十万频次的遥测流量，通过 MQTT 5.0 共享订阅机制，由 Broker 自动在 NestForge 的多个 Pod 间均匀轮询分发，支持水平弹性扩容且无需复杂的消费组重平衡。
4. **单向事件驱动解耦 (Event-Driven)**：MQTT 消息进入业务层后立即沉淀为标准领域事件（`iot.telemetry.received`、`iot.alarm.triggered`），与上层展示协议（WebSocket/SSE）和时序数据库解耦，杜绝协议穿透。

---

## 2. 工业标准主题拓扑体系 (Topic Hierarchy)

主题命名体系遵循 **ISA-95 企业设备层级标准** 与 **RESTful 语义范式**。在 NestForge 中，系统原生支持命名参数提取（如 `:tenantId`、`:deviceId`）与 MQTT 5.0 共享订阅。

### 2.1 主题拓扑全景图

| 业务方向 | 逻辑主题模式 | QoS | Retain | 说明与使用场景 |
| :--- | :--- | :---: | :---: | :--- |
| **设备遥测上报** | `devices/:tenantId/:deviceId/telemetry` | **1** | false | 周期性指标上报（温度、振动、转速、能耗等），云端采用 `$share` 消费 |
| **设备生命周期** | `devices/:tenantId/:deviceId/status` | **1** | **true** | 设备在线/离线状态。**离线状态必须由 Broker 遗嘱消息 (LWT) 强制触发** |
| **异常告警事件** | `devices/:tenantId/:deviceId/events` | **1** | false | 突发工业告警（如电机超温、急停触发、断刀报警、压力骤降） |
| **数字影子更新** | `devices/:tenantId/:deviceId/shadow/update` | **1** | false | 设备上报实际状态或主动更新影子属性 |
| **控制指令下发** | `devices/:deviceId/command` | **1** | false | 平台向设备下发动作指令（如调速、启停、配方下发、复位） |
| **RPC 同步回复** | `app/rpc/:podId/reply` | **1** | false | 设备执行指令后的回执管道，带 `correlationData` 路由至发起请求的单 Pod |

---

## 3. 工业物模型数据载荷规范 (Industrial Payload Spec)

工业设备通信必须具备**毫秒级时间戳、唯一标识、状态质量戳（Quality Code）以及强类型字段约束**。

### 3.1 设备遥测上报 (Telemetry Payload)

* **主题**：`devices/{tenantId}/{deviceId}/telemetry`
* **QoS 策略**：工业遥测数据推荐采用 **QoS 1**（配合边缘网关消息缓存与去重，防止弱网丢包；超高频振动采样可降为 QoS 0）。
* **JSON Schema 范式**：

```json
{
  "timestamp": 1726053600123,
  "status": "operating",
  "temperature": 72.4,
  "vibration": 1.28,
  "rpm": 1480,
  "current": 15.6,
  "pressure": 6.2,
  "quality": 192,
  "metrics": {
    "bearingTemp": 68.2,
    "oilLevel": 92.5,
    "dailyOutput": 420
  }
}
```

> **字段说明**：
>
> * `timestamp`: 毫秒级 Unix 时间戳（边缘设备采集时刻，非云端接收时刻，保证时序准确性）。
> * `status`: 设备运行状态：`idle` (待机)、`operating` (加工中)、`fault` (故障停机)、`maintenance` (维保检修)。
> * `quality`: 工业 OPC 质量戳（`192 (0xC0)` 代表 Good 正常；`0 (0x00)` 代表 Bad 传感器断线/故障；`64 (0x40)` 代表 Uncertain 校验不确定）。

---

### 3.2 设备生命周期与遗嘱消息 (LWT Status Payload)

工业物联网必须准确感知设备非正常离线（如车间动力电跳闸、网线断开、工控机死机）。

* **主题**：`devices/{tenantId}/{deviceId}/status`
* **QoS 策略**：**QoS 1**，且必须设置 **`retain: true`**（让新上线的监控端立即读到最新状态）。
* **MQTT 客户端连接配置**：设备在建立 MQTT 连接时，向 Broker 注册如下**遗嘱消息 (Last Will and Testament, LWT)**：
  * **遗嘱主题**：`devices/{tenantId}/{deviceId}/status`
  * **遗嘱 Payload**：`{"status":"offline","reason":"network_disruption","timestamp":1726053600000}`
  * **遗嘱 QoS**：`1`
  * **遗嘱 Retain**：`true`
* **设备正常上线 Payload**：

  ```json
  {
    "status": "online",
    "firmwareVersion": "v2.4.1",
    "ip": "192.168.10.45",
    "timestamp": 1726053600000
  }
  ```

* **设备正常下线 Payload**（设备断电前优雅退出）：

  ```json
  {
    "status": "offline",
    "reason": "graceful_shutdown",
    "timestamp": 1726053600000
  }
  ```

---

### 3.3 工业级同步 RPC 指令下发 (Command & Response)

NestForge 利用 MQTT 5.0 的 `responseTopic` 与 `correlationData`，实现了生产级微秒同步控制下发。

#### 1. 平台下发指令数据包 (Request)

* **发布主题**：`devices/{deviceId}/command`
* **MQTT 5.0 Header Properties**：
  * `responseTopic`: `app/rpc/{podId}/reply`（指向当前发起请求的 NestForge Pod 私有通道）
  * `correlationData`: `b3f1c9d2-4e8a-4b91-9c8e-2f7a6b5c4d3e`（全局唯一关联 ID）
  * `userProperties`: `{"tenantId":"acme-factory","operator":"admin","dispatchAt":"1726053600000"}`
  * `messageExpiryInterval`: `10`（10 秒内设备未接收则 Broker 自动抛弃，防止堆积下发）
* **指令 Payload**：

  ```json
  {
    "command": "SET_MOTOR_SPEED",
    "params": {
      "targetRpm": 1800,
      "rampUpTimeSec": 5,
      "torqueLimit": 85
    },
    "timestamp": 1726053600000
  }
  ```

#### 2. 设备执行并回传响应 (Response)

现场网关接收到指令并由 PLC 执行完毕后，必须原样提取 MQTT 5.0 属性中的 `responseTopic` 与 `correlationData` 发送应答：

* **发布目标**：`responseTopic`（即 `app/rpc/{podId}/reply`）
* **MQTT 5.0 Header Properties**：
  * `correlationData`: 原样带回请求包中的二进制/字符串 ID
* **响应 Payload**：

  ```json
  {
    "success": true,
    "code": 0,
    "message": "电机转速已平滑加速至 1800 RPM",
    "data": {
      "actualRpm": 1800,
      "motorTemp": 45.2,
      "currentDraw": 12.8
    },
    "executionTimeMs": 142
  }
  ```

---

## 4. NestForge 服务端实现规范 (Server Implementation)

NestForge 在统一顶级模块 `src/iot/` 中提供了现代化的声明式注解、传输适配器与工业物联网服务。

### 4.1 核心依赖与连接配置

在 `.env` 中声明标准 DSN 连接：

```bash
# 工业 MQTT 5.0 连接配置 (支持账号密码、TLS 及 ClientId 模板)
MQTT_URL="mqtts://iot_server_user:secret_token@broker.factory.internal:8883?clientId=nestforge-core-worker&keepalive=30&clean=false&reconnectPeriod=2000"
```

### 4.2 遥测处理与共享订阅集群 ($share)

在业务服务中通过 `@MqttSubscribe` 搭配 `sharedGroup` 装饰器，实现跨 Pod 负载均衡：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MqttSubscribe, MqttPayload, MqttParams, MqttCtx, type MqttMessageContext } from '@/iot';
import { IOT_EVENTS } from '@/common/events';

@Injectable()
export class IotTelemetryService {
  private readonly logger = new Logger(IotTelemetryService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * 监听工业设备遥测上报
   * sharedGroup 自动将真实 MQTT 订阅转换为: $share/telemetry-workers/devices/+/+/telemetry
   * 支持千万级测点多 Pod 无锁消费
   */
  @MqttSubscribe('devices/:tenantId/:deviceId/telemetry', {
    qos: 1,
    sharedGroup: 'telemetry-workers',
  })
  handleTelemetry(
    @MqttPayload() telemetry: Record<string, any>,
    @MqttParams('tenantId') tenantId: string,
    @MqttParams('deviceId') deviceId: string,
    @MqttCtx() context: MqttMessageContext,
  ): void {
    // 1. 提取动态参数与 QoS
    this.logger.debug(`[Telemetry] ${deviceId} (${tenantId}) | Temp: ${telemetry.temperature}℃ | QoS: ${context.qos}`);

    // 2. 阈值超限触发工业告警与领域事件
    if (telemetry.temperature > 85) {
      this.eventEmitter.emit(IOT_EVENTS.ALARM_TRIGGERED, {
        tenantId,
        deviceId,
        level: 'critical',
        metric: 'temperature',
        value: telemetry.temperature,
        threshold: 85,
        timestamp: Date.now(),
      });
    }

    // 3. 派发遥测上报领域事件 (供 WebSocket / SSE 模块实时广播推流到大屏)
    this.eventEmitter.emit(IOT_EVENTS.TELEMETRY_RECEIVED, {
      tenantId,
      deviceId,
      telemetry,
      timestamp: Date.now(),
    });
  }

  /**
   * 监听设备生命周期与遗嘱消息 (LWT)
   */
  @MqttSubscribe('devices/:tenantId/:deviceId/status', { qos: 1 })
  handleDeviceStatus(
    @MqttPayload() payload: { status: 'online' | 'offline'; reason?: string },
    @MqttParams('tenantId') tenantId: string,
    @MqttParams('deviceId') deviceId: string,
  ): void {
    this.logger.warn(`[Device Status] ${deviceId} -> ${payload.status} (原因: ${payload.reason ?? 'N/A'})`);
    this.eventEmitter.emit(IOT_EVENTS.DEVICE_STATUS_CHANGED, {
      tenantId,
      deviceId,
      status: payload.status,
      reason: payload.reason,
      timestamp: Date.now(),
    });
  }
}
```

### 4.3 同步控制下发 (MqttService.request RPC)

```typescript
import { Injectable } from '@nestjs/common';
import { MqttService } from '@/iot';

@Injectable()
export class IotCommandService {
  constructor(private readonly mqttService: MqttService) {}

  async adjustMotorSpeed(deviceId: string, targetRpm: number) {
    // 同步阻塞等待设备响应，默认 5000ms 超时，底层自动生成 correlationData 并匹配 responseTopic
    const result = await this.mqttService.request(
      `devices/${deviceId}/command`,
      {
        command: 'SET_MOTOR_SPEED',
        params: { targetRpm },
        timestamp: Date.now(),
      },
      {
        timeoutMs: 3000,
        qos: 1,
        userProperties: { dispatchedBy: 'NestForge-WebController' },
      },
    );

    return result;
  }
}
```

---

## 5. 边缘端与网关接入实战 (Edge Gateway & Device Examples)

### 5.1 Python 工业网关接入范式 (Paho-MQTT 2.0 / 边缘工控机)

适用于树莓派、工控机（IPC）、Linux 边缘计算盒子等场景，采集 Modbus/OPC-UA 后上传：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NestForge 工业边缘网关生产级参考实现 (Python 3.10+ / paho-mqtt v2.0+)
特性：TLS 安全加密、MQTT 5.0 请求响应 RPC、遗嘱离线通知 (LWT)、指数退避自动重连
"""

import json
import ssl
import time
import uuid
import paho.mqtt.client as mqtt
from paho.mqtt.properties import Properties
from paho.mqtt.packettypes import PacketTypes

TENANT_ID = "factory-01"
DEVICE_ID = "cnc-lathe-007"
BROKER_HOST = "broker.factory.internal"
BROKER_PORT = 8883
USERNAME = "device_cnc_007"
PASSWORD = "strong_device_token"

STATUS_TOPIC = f"devices/{TENANT_ID}/{DEVICE_ID}/status"
TELEMETRY_TOPIC = f"devices/{TENANT_ID}/{DEVICE_ID}/telemetry"
COMMAND_TOPIC = f"devices/{DEVICE_ID}/command"

def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        print(f"[MQTT Connected] 成功接入工业云网关 (ReasonCode: {reason_code})")
        # 1. 发布正常上线状态 (Retained=True)
        online_payload = {
            "status": "online",
            "firmwareVersion": "v1.2.0",
            "timestamp": int(time.time() * 1000)
        }
        client.publish(STATUS_TOPIC, json.dumps(online_payload), qos=1, retain=True)

        # 2. 订阅控制指令下发管道
        client.subscribe(COMMAND_TOPIC, qos=1)
        print(f"[Subscribed] 已监听设备控制指令: {COMMAND_TOPIC}")
    else:
        print(f"[Connect Failed] 接入失败，错误码: {reason_code}")

def on_message(client, userdata, msg):
    """处理平台下发的控制指令，并基于 MQTT 5.0 响应回执"""
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
        print(f"\n[Command Received] 收到控制指令: {payload.get('command')}")

        # 提取 MQTT 5.0 RPC 回传属性
        response_topic = None
        correlation_data = None
        if msg.properties:
            response_topic = getattr(msg.properties, "ResponseTopic", None)
            correlation_data = getattr(msg.properties, "CorrelationData", None)

        # 模拟执行 PLC 控制动作
        cmd_name = payload.get("command")
        success = True
        result_msg = f"指令 {cmd_name} 执行完毕"

        # 构造执行应答
        reply_payload = {
            "success": success,
            "code": 0,
            "message": result_msg,
            "data": {
                "executedAt": int(time.time() * 1000),
                "deviceRpm": payload.get("params", {}).get("targetRpm", 1200)
            }
        }

        # 若存在 MQTT 5.0 RPC 回复要求，立即回传
        if response_topic and correlation_data:
            reply_props = Properties(PacketTypes.PUBLISH)
            reply_props.CorrelationData = correlation_data
            client.publish(
                response_topic,
                json.dumps(reply_payload),
                qos=1,
                properties=reply_props
            )
            print(f"[RPC Replied] 响应已送达目标管道: {response_topic}")

    except Exception as e:
        print(f"[Command Error] 解析指令失败: {e}")

def main():
    # 使用 MQTT 5.0 协议初始化
    client = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"edge-gateway-{DEVICE_ID}",
        protocol=mqtt.MQTTv5
    )
    client.username_pw_set(USERNAME, PASSWORD)

    # 1. 设置 TLS 加密 (生产环境建议启用 mTLS 客户端证书)
    client.tls_set(cert_reqs=ssl.CERT_REQUIRED, tls_version=ssl.PROTOCOL_TLS_CLIENT)

    # 2. 配置 MQTT 5.0 遗嘱消息 (LWT) —— 毫秒级断网感知
    lwt_payload = json.dumps({
        "status": "offline",
        "reason": "hardware_power_loss",
        "timestamp": int(time.time() * 1000)
    })
    client.will_set(STATUS_TOPIC, payload=lwt_payload, qos=1, retain=True)

    client.on_connect = on_connect
    client.on_message = on_message

    print(f"[Starting] 正在连接工业 Broker: {BROKER_HOST}:{BROKER_PORT} ...")
    client.connect(BROKER_HOST, BROKER_PORT, keepalive=30)
    client.loop_start()

    try:
        while True:
            # 模拟工业现场传感器周期遥测采集 (2秒频次)
            telemetry_data = {
                "timestamp": int(time.time() * 1000),
                "status": "operating",
                "temperature": 68.5,
                "vibration": 1.15,
                "rpm": 1500,
                "quality": 192
            }
            client.publish(TELEMETRY_TOPIC, json.dumps(telemetry_data), qos=1)
            time.sleep(2)
    except KeyboardInterrupt:
        print("\n[Shutting Down] 正在安全断开连接...")
        # 优雅退出时更新状态为离线
        offline_payload = json.dumps({
            "status": "offline",
            "reason": "operator_manual_stop",
            "timestamp": int(time.time() * 1000)
        })
        client.publish(STATUS_TOPIC, offline_payload, qos=1, retain=True)
        client.loop_stop()
        client.disconnect()

if __name__ == "__main__":
    main()
```

---

### 5.2 嵌入式 C / C++ 接入范式 (Eclipse Paho C / RTOS / ESP32)

对于资源受限的微控制器（MCU / STM32 / ESP32），建议基于 Eclipse Paho Embedded C 或 FreeRTOS MQTT Agent：

```c
#include "MQTTClient.h"
#include <stdio.h>
#include <string.h>

#define ADDRESS     "ssl://broker.factory.internal:8883"
#define CLIENTID    "stm32-sensor-01"
#define TOPIC       "devices/factory-01/stm32-sensor-01/telemetry"
#define STATUS_TPC  "devices/factory-01/stm32-sensor-01/status"
#define QOS         1
#define TIMEOUT     10000L

void publish_telemetry(MQTTClient client, float temp, float vibration) {
    char payload[128];
    snprintf(payload, sizeof(payload), 
             "{\"timestamp\":%ld,\"temperature\":%.2f,\"vibration\":%.2f,\"status\":\"operating\"}",
             time(NULL) * 1000, temp, vibration);

    MQTTClient_message pubmsg = MQTTClient_message_initializer;
    pubmsg.payload = payload;
    pubmsg.payloadlen = (int)strlen(payload);
    pubmsg.qos = QOS;
    pubmsg.retained = 0;

    MQTTClient_deliveryToken token;
    MQTTClient_publishMessage(client, TOPIC, &pubmsg, &token);
    MQTTClient_waitForCompletion(client, token, 1000L);
}
```

---

## 6. 工业安全加固与生产级防御准则 (Industrial Security & Hardening)

工业现场设备生命周期长达 5~15 年，安全防护必须前置并实施纵深防御（Defense-in-Depth）。

### 6.1 传输安全与双向认证 (mTLS / X.509)

* **严禁明文暴露**：生产环境严禁开启未加密的 `1883` 端口，强制使用 TLS 1.3 (`8883` 端口) 或 WSS (`9002` 端口)。
* **双向身份验签 (Mutual TLS)**：工业设备内部集成安全单元（TPM 2.0 芯片或 ATECC608 加密元件），在设备出厂时烧录唯一设备证书（X.509）。Broker 强制校验证书链（CA 根证书），杜绝恶意伪造设备。

### 6.2 Broker 鉴权与主题级访问控制 (Auth & Strict ACL)

`deploy/mosquitto` **只有生产形态**：`allow_anonymous false` + `password_file` + `acl_file`（白名单模式），匿名连接一律拒绝。

```text
deploy/mosquitto/
├── docker-compose.yml             # 挂载配置 + 凭据目录；healthcheck 探测 1883 监听器
└── config/
    ├── mosquitto.conf             # 监听器 / 鉴权 / 持久化 / 性能 / 日志（单一权威配置）
    ├── acl.example                # ACL 模板（复制为 credentials/acl.txt 后按租户/设备调整）
    └── credentials/               # 运行期凭据（已 gitignore，仅保留 .gitkeep）
        ├── password.txt           # 由 just mqtt-passwd 生成
        └── acl.txt                # 由 just mqtt-acl 生成
```

凭据准备（**首次启动前必须完成**，凭据不入库；缺失时 Broker 会启动失败，属预期快速失败）：

```bash
# 平台账号（用户名/密码须与 deploy/.env 的 MQTT_URL 逐字一致）
just mqtt-passwd -c -b /creds/password.txt nestforge-api '<强密码>'
# 设备账号（一机一密；-b 从参数读密码，切勿用 -c，否则会清空已有账号）
just mqtt-passwd -b /creds/password.txt cnc-001 '<设备密钥>'
# ACL 规则文件
just mqtt-acl
```

修改凭据后无需重启容器，执行 `docker kill -s HUP mosquitto` 即可热重载（`password_file` / `acl_file` 均支持）。

ACL 编写要点（Mosquitto `acl_file` 语义，详见 `config/acl.example`）：

1. **启用 `acl_file` 即白名单模式**：未出现的主题一律不可访问；`password_file` 的账号名才是 `user`/`%u` 的匹配对象，**不是 clientId**；
2. **`deny` 优先级高于同主题的授权**，因此不要用 `deny app/rpc/#` 去"封场"再对设备单独授权——会被 deny 直接否决；正确做法是只写最小授权（设备侧仅 `pattern write app/rpc/+/reply` 允许回执）；
3. **设备侧默认形态**：

   ```text
   pattern readwrite devices/+/%u/#    # 仅自身 deviceId 子树（遥测/状态/告警）
   pattern read devices/%u/command     # 接收平台下发的控制指令
   pattern write app/rpc/+/reply       # 仅能写定向 RPC 回执，无法订阅该通道
   ```

   该写法覆盖"同名 deviceId 跨租户"的残留越权面；如需绝对租户隔离，改为按设备逐条 `user` 规则（大规模建议由设备台账脚本生成）；
4. `pattern` 缺少 `%u`/`%c` 时 Mosquitto 会打印 `Warning: ACL pattern ... does not contain '%c' or '%u'`，属预期提示（如 `app/rpc/+/reply` 本身就是与设备身份无关的规则）。

**已实测验证**（`eclipse-mosquitto:2.1-alpine`，本仓库配置）：匿名连接与错误密码均被拒绝（`not authorised`）、设备可发布自身主题且平台可收到、设备伪造他厂设备遥测的消息**未被投递**、设备订阅他厂设备子树**收不到任何数据**。

### 6.3 边缘弱网续传与反压机制 (Backpressure & Offline Storage)

1. **边缘环形缓冲区 (Circular Buffer)**：工业现场极易遭遇电磁干扰与基站切换。边缘网关采集到的数据必须先进入本地轻量时序库（DuckDB/SQLite）或带掉电保护的内存环形队列。
2. **断网重传合并 (Coalescing)**：网络重连后，边缘网关应当限速补发历史数据，并在 Header 标注 `replayed=true`，防止瞬间万条历史数据冲垮云端时序数据库。

### 6.4 设备凭证签发与密钥域隔离 (Device Credential Issuance)

设备通过 `POST /v1/iot/devices/token` 以**预置密钥换票**：NestJS 恒定时间校验 `deviceSecret` 后签发设备 JWT 凭据（含 `jti`，便于审计与吊销）。

```bash
curl -X POST http://localhost:4300/v1/iot/devices/token \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "cnc-001", "deviceSecret": "s3cr3t-def456", "tenantId": "factory-alpha"}'
```

> **当前语义与演进路线（务必对齐）**
> Broker 侧鉴权采用 **原生 `password_file` + `acl_file`（零插件，见 §6.2）**，设备接入 Broker 使用**一机一密账号**：`username=<deviceId>`、`password=<deviceSecret>`（同一密钥需由运维写入 `password.txt`）。
> 因此本端点当前承担的是**准入校验 + 凭据签发审计**职责，其签发的 JWT **尚未被 Broker 消费**（无插件即无 JWT 验签器）。要闭合该环，需二选一：
>
> * **方案 A 后续**：把端点语义改为"发放/轮换 Broker 凭据"（如接入 Mosquitto Dynamic Security 或受控调用 `mosquitto_passwd`），无需引入插件；
> * **方案 B/C**：让 Broker 原生支持 JWT（`mosquitto-go-auth` 已于 2025-06 归档且 Alpine 镜像不可用；或迁移 EMQX/HiveMQ 等具备 JWKS 的 Broker）。
> 未完成上述演进前，请勿在安全评审中把设备 JWT 视为 Broker 准入控制手段。

相关环境变量：

| 变量 | 说明 |
| --- | --- |
| `IOT_DEVICE_CREDENTIALS` | 设备凭证表 `deviceId:secret,deviceId:secret`；**留空表示禁止换票**（一律 401） |
| `IOT_JWT_SECRET` | 设备接入 JWT 独立签名密钥（≥32 字符），**必须与 `BETTER_AUTH_SECRET` 域分离**；未配置时返回 503 |
| `IOT_DEVICE_PEPPER` | 凭证摘要的 HMAC 加固盐值（≥16 字符），生产环境务必显式配置 |
| `IOT_TOKEN_TTL_SECONDS` | 凭据有效期（秒），默认 30 天；缩短有效期需设备侧配合静默续签 |

安全语义：

1. **恒定时间比较**：密钥错误与设备未注册返回同一条 `401 设备凭证无效`，且两条路径均执行完整的 HMAC 比较，杜绝通过响应耗时探测设备是否已注册；
2. **绝不回退硬编码密钥**：`IOT_JWT_SECRET` 缺失时 fail fast（503），避免弱默认密钥被用于伪造设备身份；
3. **限流**：该端点位于 `@Public()` 白名单（设备无法持有用户会话），已叠加 `@Throttle` 每分钟 5 次，防止凭证爆破；
4. **吊销与轮换**：JWT 携带 `jti` 以支持黑名单即时吊销；轮换设备密钥需**双处同步**——平台侧 `IOT_DEVICE_CREDENTIALS`（滚动重启 API）与 Broker 侧 `password.txt`（`docker kill -s HUP mosquitto` 热重载），否则会出现"能换票但连不上 Broker"或反之的割裂状态。

---

## 7. 联调与测试验证套件 (Testing & Verification)

### 7.1 本地测试工具链

#### 1. CLI 命令行调试工具 (mosquitto-clients)

> Broker 已强制鉴权，以下命令均需携带凭据：设备侧 `-u <deviceId> -P <设备密钥>`，平台侧 `-u nestforge-api -P <平台密码>`（账号须已写入 `deploy/mosquitto/config/credentials/password.txt`）。

```bash
# 1. 模拟设备监听指令并自动回复 (MQTT 5.0)
mosquitto_sub -h localhost -p 1883 -u cnc-01 -P '<设备密钥>' \
  -t "devices/cnc-01/command" -F "%p (Props: %P)" -V 5

# 2. 模拟边缘网关向 NestForge 上报遥测
mosquitto_pub -h localhost -p 1883 -u cnc-01 -P '<设备密钥>' \
  -t "devices/tenant-demo/cnc-01/telemetry" \
  -m '{"temperature": 88.5, "status": "operating", "timestamp": 1726053600000}' \
  -q 1 -V 5
```

#### 2. GUI 调试工具推荐

* **MQTTX**（EMQX 出品，跨平台开源 GUI，完整支持 MQTT 5.0 用户属性注入与包属性查看）。

### 7.2 NestForge 内置仿真端点

系统提供了内置的模拟设备仿真接口（[IotController](file:///Users/seaside/Projects/nestjs/nest-drizzle-better-auth/src/iot/iot.controller.ts)），前端或联调人员可零硬件依赖闭环测试：

```bash
# 1. 模拟工业遥测上报并触发数字影子与告警
curl -X POST http://localhost:4300/v1/iot/devices/mock-telemetry \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "factory-alpha",
    "deviceId": "plc-press-01",
    "telemetry": {
      "temperature": 92.4,
      "status": "operating",
      "vibration": 3.8
    }
  }'

# 2. 向工业设备下发指令 (等待同步 RPC 响应)
curl -X POST http://localhost:4300/v1/iot/devices/plc-press-01/command \
  -H "Content-Type: application/json" \
  -d '{
    "command": "EMERGENCY_STOP",
    "params": { "reason": "overheat" },
    "timeoutMs": 3000
  }'
```

---

## 8. 常见故障诊断与排查清单 (Troubleshooting)

| 症状 / 异常 | 根本原因 | 生产排查与解决办法 |
| :--- | :--- | :--- |
| **设备突然离线，影子无预警停摆** | 现场动力断电或链路闪断触发 Broker LWT | 检查 Broker 是否收到遗嘱消息；排查现场交换机供电或边缘网关心跳配置 |
| **控制指令下发报 408 RequestTimeout** | 设备已掉线或现场 PLC 处理超时 | 检查设备当前在线状态；增大 `timeoutMs` 参数；确认网关是否正常回填 `correlationData` |
| **云端多个 Pod 重复消费同一条遥测** | 未配置 MQTT 5.0 共享订阅 | 检查 `@MqttSubscribe` 是否配置了 `sharedGroup: 'xxx'`，Broker 是否正确支持 `$share` |
| **设备重连后出现大量历史重放消息** | 误配置了 `cleanSession: false` 且 QoS 较高 | 工业状态监控通常只需要最新值，遥测上报建议设置短期 `messageExpiryInterval` |
| **Broker 报 Client Identifier Invalid** | 多个设备或网关使用了相同的 `clientId` | 工业设备 `clientId` 必须由 MAC 地址、芯片序列号或企业设备唯一编码生成，禁止硬编码 |
