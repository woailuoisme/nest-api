# 实时通信全栈开发与 WebSocket 客户端接入指南

> 本文档面向后端业务研发、Web、移动端（iOS / Android / Flutter）、微信小程序以及桌面端开发团队，系统性规定了：
>
> 1. **服务端 `@src/realtime` 架构与业务开发规范**（服务直发、领域事件解耦驱动、声明式 `@ChannelAuth` 规则、Centrifugo 原生集群在场感知）；
> 2. **WebSocket 全功能通信协议与长连接生命周期管理**；
> 3. **频道多路复用与双模式订阅鉴权**（Proxy Webhook 自动授权 vs Subscription Token 预签换票）；
> 4. **4 大核心客户端平台生产级实现**（**TypeScript**、**Dart / Flutter**、**Android / Kotlin**、**微信小程序原生**）；
> 5. **Bruno 自动化 API & WebSocket 联调测试指南**。

---

## 1. WebSocket 架构与生命周期 (Connection Lifecycle)

系统采用 **Centrifugo (v5)** 作为分布式实时消息网关。WebSocket 是推荐的**主力全功能通信协议**，支持在单一物理 TCP 长连接上实现**频道多路复用**、**断网自愈与离线消息自动恢复 (Publication Recovery)** 以及 **在场成员感知 (Presence)**。

### 1.1 服务端点信息

| 环境 | 物理 WebSocket 端点 | 反向代理路径 (WSS) |
| :--- | :--- | :--- |
| **本地联调** | `ws://localhost:8000/connection/websocket` | - |
| **生产环境** | - | `wss://api.yourdomain.com/connection/websocket` |

---

### 1.2 连接状态机 (State Machine)

客户端长连接具备以下标准状态生命周期：

```mermaid
stateDiagram-v2
    [*] --> Disconnected: 初始化
    Disconnected --> Connecting: connect() / 自动重连
    Connecting --> Connected: 握手成功 (Connect OK)
    Connecting --> Disconnected: 网络故障 / Token 无效 (109)
    Connected --> Connecting: 网络抖动 / 心跳超时 (110)
    Connected --> Disconnected: 主动 disconnect() / 强制下线 (3501)
```

1. **Disconnected (已断开)**：初始状态或调用 `disconnect()` 后的休眠状态。
2. **Connecting (连接中)**：客户端向业务后端换取 Connection Token，并向网关发起 WebSocket 握手。
3. **Connected (已连接)**：网关验签通过，分配唯一 `client_id`，客户端可以开始订阅频道或接收推送。
4. **离线自动恢复 (Publication Recovery)**：当因移动网络切换等原因短暂断开重连时，网关通过比较消息 `offset` / `epoch` 自动向客户端补发断网期间未接收的历史消息。

---

## 2. 频道分类与双模式订阅鉴权 (Channels & Authentication)

在 WebSocket 长连接就绪后，客户端可通过单一物理连接多路复用（Multiplexing）同时订阅多个业务频道。

### 2.1 频道分类与准入规则

| 频道前缀 | 鉴权机制 | 客户端换票要求 | 典型场景 |
| :--- | :--- | :--- | :--- |
| **`user#${userId}`** | 网关本地验签 (User-Bound) | **无需申请 Token**，网关直接比对 `userId === JWT.sub` | 个人通知红点、私信、审批流转、被踢下线通知 |
| **`public:${name}`** | 全网公开可读 (Open Channel) | **无需申请 Token**，任何合法长连接均可订阅 | 系统维护公告、全员大厅广播 |
| **`room:${roomId}`** | 资源成员鉴权 (Resource ACL) | **双模式支持**（推荐 Proxy Webhook 自动鉴权） | 协同白板、协作文档、多人在线名单 |
| **`admin:${topic}`** | 角色权限强校验 (RBAC) | **双模式支持**（推荐 Proxy Webhook 自动鉴权） | 实时监控大屏、服务器告警指标、系统审计事件 |
| **`device:${deviceId}`** | 物联网设备鉴权 (IoT ACL) | **双模式支持**（推荐 Proxy Webhook 自动鉴权） | 工业设备遥测直推、物联数据影子监控 |

---

### 2.2 双模式频道授权体系 (Dual-Mode Channel Authorization)

对于受控私有频道（如 `admin:*`、`room:*`、`device:*`），系统提供两种鉴权协作机制：

```mermaid
flowchart TD
    subgraph ModeA["模式 A: Proxy Webhook (生产强烈推荐)"]
        A1["客户端发起 subscribe(channel)"] --> A2["Centrifugo 网关拦截"]
        A2 -->|"HTTP Webhook 回调<br/>POST /v1/realtime/proxy/subscribe"| A3["NestJS ChannelManager<br/>(@ChannelAuth 规则校验)"]
        A3 -->|"返回 200 OK / 103 Forbidden"| A2
        A2 -->|"下发 Subscribed 成功 / 失败"| A1
    end

    subgraph ModeB["模式 B: Subscription Token (传统/离线换票)"]
        B1["客户端调 REST API<br/>POST /v1/realtime/subscribe"] --> B2["NestJS 校验权限并签发 Token"]
        B2 -->|"返回 subscriptionToken (JWT)"| B1
        B1 -->|"携带 Token 发起 subscribe(channel, token)"| B3["Centrifugo 网关本地 HMAC 验签"]
        B3 -->|"下发 Subscribed 成功"| B1
    end
```

1. **模式 A：Proxy Webhook 自动鉴权（生产强烈推荐）**：
   - **机制**：客户端无需提前发起 HTTP 换票请求，直接向 Centrifugo 发送订阅指令帧。网关依据 `proxy_subscribe` 配置自动向业务后端发起 Webhook 回调（`POST /v1/realtime/proxy/subscribe`）。
   - **优势**：
     - **零多余网络往返**：省去客户端调用 HTTP 换票的延迟，极大提升多人协作与频道切换的流畅度。
     - **实时强一致准入**：每次订阅均由后端实时读取用户当前角色或会话上下文，杜绝过期票据带来的越权隐患。
   - **统一契约**：服务端统一由 `RealtimeEventsService.handleProxySubscribe` 委托给 `ChannelManager` 校验。

2. **模式 B：Subscription Token 预签换票模式（传统/备用兼容）**：
   - **机制**：客户端在订阅受控频道前，先调用业务 RESTful 接口 `POST /v1/realtime/subscribe`，获取使用 HMAC-SHA256 签发、带时效的 `Subscription Token`，并在 WebSocket 发送带 `token` 的订阅帧。
   - **适用**：第三方无法直接监听网关 Webhook 的受限内网环境，或需要提前静态生成离线预授权凭证的特殊场景。

---

### 2.3 规范化单一推流原则 (Single Canonical Pipeline)

在传统 WebSocket 架构中，向用户推送个人消息往往容易产生“多倍放大”问题（例如同一事件同时推给 `user#${userId}`、`private:notifications`、`private:user.${userId}` 等多个冗余频道）。

NestForge 确立**规范化单一推流原则**：

- **个人通知频道唯一规范**：一律由 `RealtimeService.sendToUser(userId, ...)` 下发至 `user#${userId}` 专属通道；Centrifugo 网关集群在传输层自动向该用户的所有多端设备长连接扇出（Fan-out），彻底消除应用层克隆与网络流量倍增。
- **广播通知频道唯一规范**：全站广播统一下发至 `public:notifications`。
- **设备遥测频道唯一规范**：工业设备遥测统一推送到 `device:${deviceId}`，全网警报统一下发至 `admin:iot-alarms`。

> 🔒 **客户端发布安全红线**：
> 客户端**严禁直接通过 WebSocket 向频道推送业务消息**（网关全局配置 `publish: false`）。所有消息写入必须通过业务 RESTful API 提交，经后端权限校验与业务编排后统一向网关广播，杜绝客户端伪造事件。

---

## 3. 服务端 `@src/realtime` 架构与业务开发指南 (Backend Guide)

`src/realtime/` 是全栈实时通信中枢的**深度门面模块 (Deep Module)**，封装了所有广播推流、Token 鉴权、事件驱动以及在场感知能力。

### 3.1 核心导出与依赖拓扑

```mermaid
graph TD
    subgraph RealtimeModule["@Global() RealtimeModule"]
        RS["RealtimeService<br/>(业务直发 / Token签发 / 广播门面)"]
        RES["RealtimeEventsService<br/>(领域事件监听 / Webhook鉴权处理)"]
        CM["ChannelManager<br/>(频道路由模式匹配 / @ChannelAuth 注册表)"]
        PS["PresenceService<br/>(Centrifugo 原生集群在场感知)"]
        CT["CentrifugoTransport<br/>(Centrifugo v5 HTTP Engine 通信适配)"]
    end

    Controller["RealtimeController<br/>(/v1/realtime/*)"] --> RS
    Controller --> RES
    RES --> RS
    RS --> CM
    RS --> CT
    PS --> CT
```

- [`RealtimeService`](file:///Users/seaside/Projects/nestjs/nest-drizzle-better-auth/src/realtime/realtime.service.ts)：提供 `sendToUser`、`broadcast`、`batchBroadcast` 等直发 API，供业务 Service 注入调用。
- [`RealtimeEventsService`](file:///Users/seaside/Projects/nestjs/nest-drizzle-better-auth/src/realtime/realtime-events.service.ts)：监听系统领域事件（如 `notification.sent`、`notification.broadcast`、`IOT_EVENTS.*`），自动执行规范频道分发；同时处理 Centrifugo Proxy Subscribe 回调。
- [`PresenceService`](file:///Users/seaside/Projects/nestjs/nest-drizzle-better-auth/src/realtime/channels/presence.service.ts)：通过 Centrifugo HTTP API 直接查询集群真实活跃在线成员，支持本地内存透明降级，零 Redis 巡检负担。
- [`ChannelManager`](file:///Users/seaside/Projects/nestjs/nest-drizzle-better-auth/src/realtime/channels/channel-manager.service.ts)：频道权限模式匹配引擎，支持命名参数提取与默认安全拦截。
- [`@ChannelAuth`](file:///Users/seaside/Projects/nestjs/nest-drizzle-better-auth/src/realtime/channels/decorators/channel-auth.decorator.ts)：声明式频道鉴权装饰器，启动时自动自省发现并注册入 `ChannelManager`。

---

### 3.2 模式一：业务服务直发模式 (`RealtimeService`)

在任何业务服务（如 `NotificationService`、`ChatService`、`OrderService`）中，直接注入 `RealtimeService` 即可下发推流。

#### 1. 向指定用户推送私信 / 状态更新 (`sendToUser`)

```typescript
import { Injectable } from '@nestjs/common';
import { RealtimeService } from '@/realtime';

@Injectable()
export class OrderService {
  constructor(private readonly realtimeService: RealtimeService) {}

  async markAsShipped(orderId: string, userId: string) {
    // 业务落库与状态更新...

    // 向指定用户的所有在线设备精准单播推送
    this.realtimeService.sendToUser(userId, 'order.shipped', {
      orderId,
      status: 'SHIPPED',
      shippedAt: new Date().toISOString(),
    });
  }
}
```

#### 2. 向指定命名频道全员广播 (`broadcast`)

```typescript
import { Injectable } from '@nestjs/common';
import { RealtimeService } from '@/realtime';

@Injectable()
export class SystemNoticeService {
  constructor(private readonly realtimeService: RealtimeService) {}

  async broadcastAnnouncement(title: string, content: string) {
    // 向公开大厅频道广播系统通知
    this.realtimeService.broadcast('public:notifications', 'announcement', {
      title,
      content,
      publishedAt: Date.now(),
    });
  }
}
```

#### 3. 批量多频道管道广播 (`batchBroadcast`)

当需要一次性向数十个不同频道推送事件时，推荐使用 Centrifugo 批量 HTTP API，单次网络往返即可完成多路分发：

```typescript
await this.realtimeService.batchBroadcast([
  { channel: 'room:101', event: 'round_started', data: { round: 1 } },
  { channel: 'room:102', event: 'round_started', data: { round: 1 } },
  { channel: 'admin:metrics', event: 'batch_executed', data: { count: 2 } },
]);
```

---

### 3.3 模式二：领域事件驱动解耦模式 (`EventEmitter2`)

对于追求高内聚、低耦合的企业级架构，业务 Service **完全无需显式依赖 `RealtimeService`**，只需抛出标准领域事件，由 [`RealtimeEventsService`](file:///Users/seaside/Projects/nestjs/nest-drizzle-better-auth/src/realtime/realtime-events.service.ts) 自动监听并推流。

```mermaid
sequenceDiagram
    participant Biz as 业务服务 (如 NotificationsService)
    participant Bus as 事件总线 (EventEmitter2)
    participant RES as RealtimeEventsService
    participant Gate as Centrifugo 网关
    participant Client as 客户端 WebSocket

    Biz->>Bus: emit('notification.sent', new NotificationSentEvent(...))
    Bus->>RES: @OnEvent('notification.sent')
    RES->>Gate: sendToUser(userId, 'notification', payload)
    Gate->>Client: user#userId 频道推送
```

#### 核心领域事件对照表

| 领域事件名称 | 事件载荷类型 | 自动路由频道 | 说明 |
| :--- | :--- | :--- | :--- |
| **`notification.sent`** | `NotificationSentEvent` | `user#${userId}` | 自动向目标用户唯一规范个人频道推流 |
| **`notification.broadcast`** | `NotificationBroadcastEvent` | `public:notifications` | 自动向全员公开通知频道推流 |
| **`iot.device.telemetry`** | `IotTelemetryReceivedEvent` | `device:${deviceId}` | 自动向设备专属遥测频道推流 |
| **`iot.device.status`** | `IotDeviceStatusChangedEvent` | `device:${deviceId}` | 自动向设备状态变更频道推流 |
| **`iot.device.alarm`** | `IotAlarmTriggeredEvent` | `device:${deviceId}` & `admin:iot-alarms` | 同时向设备频道与管理员告警大屏分发 |
| **`iot.device.command`** | `IotCommandExecutedEvent` | `device:${deviceId}` | 指令下发执行回执推流 |

---

### 3.4 声明式频道权限规则编写 (`@ChannelAuth`)

当业务需要引入新的受控私有频道（如协作房间 `room:{roomId}`、订单实时流 `private:orders.{orderId}`）时，只需在任意业务 Service 的方法上添加 `@ChannelAuth(pattern)` 装饰器。

系统在启动时（`ChannelExplorerService`）会自动扫描并注册规则。**无论客户端采用 Proxy Webhook 还是 Subscription Token，均自动复用该规则，实现单一事实来源 (Single Source of Truth)**。

```typescript
import { Injectable } from '@nestjs/common';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ChannelAuth } from '@/realtime';

@Injectable()
export class CollaborationService {
  /**
   * 声明式频道授权规则：room:{roomId}
   * @param user 当前请求用户的上下文 (已由 JWT 解析注入)
   * @param params 从频道名称中提取的命名参数映射
   */
  @ChannelAuth('room:{roomId}')
  async authorizeRoom(
    user: CurrentUserPayload,
    params: { roomId: string },
  ): Promise<boolean> {
    // 自定义业务权限判断：校验用户是否具备进入该房间的权限
    return this.isUserInRoom(user.id, params.roomId);
  }

  /**
   * 声明式频道授权规则：支持通配符 admin:*
   */
  @ChannelAuth('admin:*')
  authorizeAdmin(user: CurrentUserPayload): boolean {
    return ['super_admin', 'admin', 'operator'].includes(user.role);
  }

  private async isUserInRoom(userId: string, roomId: string): Promise<boolean> {
    // 业务数据表查询或协作状态判断...
    return true;
  }
}
```

- **参数提取规则**：`{paramName}` 将自动捕获为 `params.paramName`（不包含冒号和点号）。
- **通配符规则**：末尾 `*` 匹配该前缀下的所有子路由（例如 `admin:*` 匹配 `admin:metrics`、`admin:logs` 等）。
- **默认安全准则 (Fail-Safe)**：所有以 `private:`、`presence:`、`room:`、`admin:` 等受控前缀开头的频道，若未命中任何 `@ChannelAuth` 规则，一律默认拒绝访问。

---

### 3.5 原生集群在场感知 (`PresenceService`)

在线状态由 Centrifugo 独立网关的原生 Presence 引擎维护。NestJS 服务端无需引入复杂的 Redis 键值轮询或守护定时任务，直接调用 [`PresenceService`](file:///Users/seaside/Projects/nestjs/nest-drizzle-better-auth/src/realtime/channels/presence.service.ts) 即可高效获取集群实时在线成员。

```typescript
import { Injectable } from '@nestjs/common';
import { PresenceService } from '@/realtime';

@Injectable()
export class RoomMonitorService {
  constructor(private readonly presenceService: PresenceService) {}

  /**
   * 获取房间当前在线成员列表
   */
  async getRoomOnlineUsers(roomId: string) {
    const channel = `room:${roomId}`;
    const members = await this.presenceService.getMembers(channel);

    return members.map((m) => ({
      userId: m.userId,
      clientId: m.clientId,
      joinedAt: m.joinedAt,
    }));
  }
}
```

---

## 4. 多端客户端生产级推荐实例 (Recommended Implementations)

---

### 4.1 推荐实例 1：TypeScript (Web / Node / Electron)

采用官方主流 SDK [centrifuge-js (v5)](https://github.com/centrifugal/centrifuge-js)。

#### 1. 安装依赖

```bash
pnpm add centrifuge
# 或 npm install centrifuge
```

#### 2. 生产级封装 (`RealtimeClient.ts`)

```typescript
import { Centrifuge, type Subscription, type PublicationContext } from 'centrifuge';

export interface RealtimeConfig {
  wsUrl: string;
  apiBaseUrl: string;
  getAuthToken: () => string | Promise<string>;
  onUnauthorized?: () => void;
}

export interface RealtimeEnvelope<T = unknown> {
  event: string;
  channel?: string;
  targetUserId?: string;
  data: T;
  timestamp: number;
}

export class RealtimeClient {
  private client: Centrifuge;
  private config: RealtimeConfig;

  constructor(config: RealtimeConfig) {
    this.config = config;

    this.client = new Centrifuge(config.wsUrl, {
      // 自动获取与刷新 Connection JWT
      getToken: async () => {
        const authToken = await this.config.getAuthToken();
        const res = await fetch(`${this.config.apiBaseUrl}/v1/realtime/token`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          if (res.status === 401) this.config.onUnauthorized?.();
          throw new Error(`获取长连接凭证失败: HTTP ${res.status}`);
        }

        const data = await res.json();
        return data.token;
      },
      minReconnectDelay: 1000,
      maxReconnectDelay: 20000,
      maxServerPingDelay: 10000,
    });

    this.initLifecycle();
  }

  private initLifecycle() {
    this.client.on('connecting', (ctx) => console.info('[Realtime] 正在连接网关...', ctx.reason));
    this.client.on('connected', (ctx) => console.info('[Realtime] 网关已连接! Client ID:', ctx.client));
    this.client.on('disconnected', (ctx) => console.warn('[Realtime] 连接断开:', ctx.reason));
    this.client.on('error', (ctx) => console.error('[Realtime] 客户端异常:', ctx.error));
  }

  public connect() {
    this.client.connect();
  }

  public disconnect() {
    this.client.disconnect();
  }

  public getClientId(): string {
    return this.client.getClientId();
  }

  /**
   * 订阅用户专属通知频道 (user#userId) - 免申请 Token
   */
  public subscribeUser(userId: string, onMessage: (envelope: RealtimeEnvelope) => void): Subscription {
    const sub = this.client.newSubscription(`user#${userId}`);
    sub.on('publication', (ctx: PublicationContext) => onMessage(ctx.data as RealtimeEnvelope));
    sub.on('subscribed', (ctx) => console.info(`[Realtime] 个人频道已就绪, 离线恢复: ${ctx.recovered}`));
    sub.subscribe();
    return sub;
  }

  /**
   * 订阅公开广播频道 (public:name)
   */
  public subscribePublic(name: string, onMessage: (envelope: RealtimeEnvelope) => void): Subscription {
    const sub = this.client.newSubscription(`public:${name}`);
    sub.on('publication', (ctx: PublicationContext) => onMessage(ctx.data as RealtimeEnvelope));
    sub.subscribe();
    return sub;
  }

  /**
   * 订阅受限协作房间频道 (room:roomId) - 自动动态换票，支持 Presence
   */
  public subscribeRoom(
    roomId: string,
    options: {
      onMessage: (envelope: RealtimeEnvelope) => void;
      onJoin?: (info: unknown) => void;
      onLeave?: (info: unknown) => void;
    },
  ): Subscription {
    const sub = this.client.newSubscription(`room:${roomId}`, {
      getToken: async (ctx) => {
        const authToken = await this.config.getAuthToken();
        const res = await fetch(`${this.config.apiBaseUrl}/v1/realtime/subscribe`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            channel: ctx.channel,
            client: this.client.getClientId(),
          }),
        });

        if (!res.ok) throw new Error(`申请房间凭证失败: HTTP ${res.status}`);
        const data = await res.json();
        return data.token;
      },
    });

    sub.on('publication', (ctx: PublicationContext) => options.onMessage(ctx.data as RealtimeEnvelope));
    if (options.onJoin) sub.on('join', (ctx) => options.onJoin!(ctx.info));
    if (options.onLeave) sub.on('leave', (ctx) => options.onLeave!(ctx.info));

    sub.subscribe();
    return sub;
  }
}
```

---

### 4.2 推荐实例 2：Dart (Flutter 移动端)

采用官方 [centrifuge-dart](https://pub.dev/packages/centrifuge) 库。

#### 1. 添加依赖 (`pubspec.yaml`)

```yaml
dependencies:
  centrifuge: ^0.14.0
  http: ^1.2.0
```

#### 2. Flutter 实时通信服务 (`realtime_service.dart`)

```dart
import 'dart:async';
import 'dart:convert';
import 'package:centrifuge/centrifuge.dart' as centrifuge;
import 'package:http/http.dart' as http;

class RealtimeService {
  late centrifuge.Client _client;
  final String wsUrl;
  final String apiBaseUrl;
  final Future<String> Function() getAuthToken;

  RealtimeService({
    required this.wsUrl,
    required this.apiBaseUrl,
    required this.getAuthToken,
  });

  /// 初始化并建立连接
  Future<void> init() async {
    final authToken = await getAuthToken();
    final res = await http.get(
      Uri.parse('$apiBaseUrl/v1/realtime/token'),
      headers: {'Authorization': 'Bearer $authToken'},
    );

    if (res.statusCode != 200) {
      throw Exception('获取连接凭据失败: HTTP ${res.statusCode}');
    }

    final connectionToken = jsonDecode(res.body)['token'] as String;

    _client = centrifuge.createClient(
      wsUrl,
      centrifuge.ClientConfig(
        token: connectionToken,
        getToken: (event) async {
          final refreshedAuthToken = await getAuthToken();
          final refreshRes = await http.get(
            Uri.parse('$apiBaseUrl/v1/realtime/token'),
            headers: {'Authorization': 'Bearer $refreshedAuthToken'},
          );
          return jsonDecode(refreshRes.body)['token'] as String;
        },
      ),
    );

    _client.connected.listen((event) {
      print('[Realtime] Flutter 长连接已建立: client=${event.client}');
    });

    _client.disconnected.listen((event) {
      print('[Realtime] Flutter 连接断开: reason=${event.reason}');
    });

    await _client.connect();
  }

  /// 订阅个人专属频道 (user#userId)
  centrifuge.Subscription subscribeUser(
    String userId,
    void Function(Map<String, dynamic> data) onMessage,
  ) {
    final sub = _client.newSubscription('user#$userId');

    sub.publication.listen((event) {
      final payload = jsonDecode(utf8.decode(event.data)) as Map<String, dynamic>;
      onMessage(payload);
    });

    sub.subscribe();
    return sub;
  }

  /// 订阅协同房间频道 (room:roomId)
  Future<centrifuge.Subscription> subscribeRoom({
    required String roomId,
    required void Function(Map<String, dynamic> data) onMessage,
    void Function(dynamic user)? onJoin,
    void Function(dynamic user)? onLeave,
  }) async {
    final channel = 'room:$roomId';
    final authToken = await getAuthToken();

    final res = await http.post(
      Uri.parse('$apiBaseUrl/v1/realtime/subscribe'),
      headers: {
        'Authorization': 'Bearer $authToken',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'channel': channel,
        'client': _client.clientId,
      }),
    );

    if (res.statusCode != 200) {
      throw Exception('获取房间准入凭据失败: HTTP ${res.statusCode}');
    }

    final subToken = jsonDecode(res.body)['token'] as String;

    final sub = _client.newSubscription(
      channel,
      centrifuge.SubscriptionConfig(token: subToken),
    );

    sub.publication.listen((event) {
      final payload = jsonDecode(utf8.decode(event.data)) as Map<String, dynamic>;
      onMessage(payload);
    });

    if (onJoin != null) sub.join.listen((event) => onJoin(event.info));
    if (onLeave != null) sub.leave.listen((event) => onLeave(event.info));

    sub.subscribe();
    return sub;
  }

  void dispose() {
    _client.disconnect();
  }
}
```

---

### 4.3 推荐实例 3：Android (Kotlin 原生开发)

采用官方 [centrifuge-java](https://github.com/centrifugal/centrifuge-java) 并在 Kotlin 协程调度下运行。

#### 1. 引入 Gradle 依赖 (`app/build.gradle.kts`)

```kotlin
dependencies {
    implementation("io.github.centrifugal:centrifuge-java:0.4.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")
}
```

#### 2. 原生封装 (`RealtimeManager.kt`)

```kotlin
package com.app.realtime

import android.util.Log
import io.github.centrifugal.centrifuge.*
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.nio.charset.StandardCharsets

class RealtimeManager(
    private val wsUrl: String,
    private val apiBaseUrl: String,
    private val getAuthToken: suspend () -> String
) {
    private val TAG = "RealtimeManager"
    private val httpClient = OkHttpClient()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var client: Client? = null

    fun connect() {
        scope.launch {
            try {
                val connectionToken = fetchConnectionToken()
                val options = Options().apply {
                    token = connectionToken
                }

                client = Client(wsUrl, options, object : EventListener() {
                    override fun onConnected(client: Client, event: ConnectedEvent) {
                        Log.i(TAG, "Centrifugo 已连接! Client ID: ${event.client}")
                    }

                    override fun onDisconnected(client: Client, event: DisconnectedEvent) {
                        Log.w(TAG, "Centrifugo 连接断开: ${event.reason}")
                    }

                    override fun onError(client: Client, event: ErrorEvent) {
                        Log.e(TAG, "Centrifugo 异常: ${event.error.message}")
                    }
                })

                client?.connect()
            } catch (e: Exception) {
                Log.e(TAG, "连接初始化失败", e)
            }
        }
    }

    fun subscribeUser(userId: String, onMessage: (JSONObject) -> Unit): Subscription? {
        val channel = "user#$userId"
        val sub = client?.newSubscription(channel, SubscriptionOptions(), object : SubscriptionEventListener() {
            override fun onPublication(sub: Subscription, event: PublicationEvent) {
                val jsonString = String(event.data, StandardCharsets.UTF_8)
                onMessage(JSONObject(jsonString))
            }

            override fun onSubscribed(sub: Subscription, event: SubscribedEvent) {
                Log.i(TAG, "订阅个人频道成功, 离线恢复: ${event.recovered}")
            }

            override fun onError(sub: Subscription, event: SubscriptionErrorEvent) {
                Log.e(TAG, "订阅个人频道异常: ${event.error.message}")
            }
        })
        sub?.subscribe()
        return sub
    }

    fun subscribeRoom(
        roomId: String,
        onMessage: (JSONObject) -> Unit,
        onJoin: ((JSONObject) -> Unit)? = null,
        onLeave: ((JSONObject) -> Unit)? = null
    ) {
        scope.launch {
            val channel = "room:$roomId"
            val clientId = client?.clientId ?: return@launch
            val subToken = fetchSubscriptionToken(channel, clientId)

            val subOptions = SubscriptionOptions().apply {
                token = subToken
            }

            val sub = client?.newSubscription(channel, subOptions, object : SubscriptionEventListener() {
                override fun onPublication(sub: Subscription, event: PublicationEvent) {
                    val jsonString = String(event.data, StandardCharsets.UTF_8)
                    onMessage(JSONObject(jsonString))
                }

                override fun onJoin(sub: Subscription, event: JoinEvent) {
                    val userObj = JSONObject().apply {
                        put("user", event.info.user)
                        put("client", event.info.client)
                    }
                    onJoin?.invoke(userObj)
                }

                override fun onLeave(sub: Subscription, event: LeaveEvent) {
                    val userObj = JSONObject().apply {
                        put("user", event.info.user)
                    }
                    onLeave?.invoke(userObj)
                }
            })
            sub?.subscribe()
        }
    }

    private suspend fun fetchConnectionToken(): String = withContext(Dispatchers.IO) {
        val authToken = getAuthToken()
        val request = Request.Builder()
            .url("$apiBaseUrl/v1/realtime/token")
            .addHeader("Authorization", "Bearer $authToken")
            .get()
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("获取连接凭据失败: ${response.code}")
            val body = response.body?.string() ?: ""
            JSONObject(body).getString("token")
        }
    }

    private suspend fun fetchSubscriptionToken(channel: String, client: String): String = withContext(Dispatchers.IO) {
        val authToken = getAuthToken()
        val payload = JSONObject().apply {
            put("channel", channel)
            put("client", client)
        }

        val request = Request.Builder()
            .url("$apiBaseUrl/v1/realtime/subscribe")
            .addHeader("Authorization", "Bearer $authToken")
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("获取频道凭证失败: ${response.code}")
            val body = response.body?.string() ?: ""
            JSONObject(body).getString("token")
        }
    }

    fun disconnect() {
        client?.disconnect()
        scope.cancel()
    }
}
```

---

### 4.4 推荐实例 4：微信小程序 (WeChat Mini Program - 零依赖原生)

微信小程序运行于定制 JS 容器中，**不支持浏览器标准 `WebSocket` 构造函数**。推荐使用以下基于微信原生 `wx.connectSocket` / `SocketTask` 的工业级生产封装，**无需安装任何第三方 npm 包**，内建自动重连、心跳保活和完整的 Centrifugo 协议帧管理。

> ⚠️ **微信公众平台配置提醒**：
> 正式上线前，必须在微信公众平台「开发管理 -> 开发设置 -> 服务器域名」中将实时网关地址配置在 **`socket 合法域名`**（必须为 `wss://` 前缀）以及 **`request 合法域名`** 中。

#### 微信小程序专用客户端 (`wechat-realtime-client.ts`)

```typescript
export interface WechatRealtimeOptions {
  wsUrl: string; // 如 wss://api.yourdomain.com/connection/websocket
  apiBaseUrl: string; // 如 https://api.yourdomain.com
  getAuthToken: () => Promise<string>;
}

export interface RealtimeEnvelope<T = unknown> {
  event: string;
  channel?: string;
  targetUserId?: string;
  data: T;
  timestamp: number;
}

export class WechatRealtimeClient {
  private socketTask: WechatMiniprogram.SocketTask | null = null;
  private commandId = 1;
  private clientId: string | null = null;
  private isConnected = false;
  private isManualClose = false;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingIntervalTimer: number | null = null;

  // 频道回调映射: channel -> Array<(envelope: RealtimeEnvelope) => void>
  private subscriptions = new Map<string, Array<(envelope: RealtimeEnvelope) => void>>();

  constructor(private options: WechatRealtimeOptions) {}

  /**
   * 发起连接
   */
  public async connect(): Promise<void> {
    this.isManualClose = false;

    // 1. 调用后端 REST 接口获取 Connection JWT
    let connectionToken: string;
    try {
      connectionToken = await this.fetchConnectionToken();
    } catch (err) {
      console.error('[WechatRealtime] 获取 Connection Token 失败:', err);
      this.scheduleReconnect();
      return;
    }

    // 2. 建立原生微信 Socket
    this.socketTask = wx.connectSocket({
      url: this.options.wsUrl,
      protocols: ['centrifuge-json'], // Centrifugo 标准 JSON 子协议
      success: () => console.info('[WechatRealtime] Socket 创建指令已下发'),
      fail: (err) => {
        console.error('[WechatRealtime] Socket 创建失败:', err);
        this.scheduleReconnect();
      },
    });

    this.bindSocketEvents(connectionToken);
  }

  private bindSocketEvents(connectionToken: string) {
    if (!this.socketTask) return;

    // 连接已打开 -> 发送 Centrifugo 协议 Connect 握手帧
    this.socketTask.onOpen(() => {
      console.info('[WechatRealtime] TCP 连接就绪，发送 Connect 握手帧...');
      this.sendFrame({
        id: this.commandId++,
        connect: {
          token: connectionToken,
        },
      });
    });

    // 收到网关消息帧
    this.socketTask.onMessage((res) => {
      const text = typeof res.data === 'string' ? res.data : '';
      if (!text) return;

      // 处理心跳空对象 {}
      if (text === '{}') {
        this.sendPing();
        return;
      }

      try {
        const frame = JSON.parse(text);
        this.handleCentrifugoFrame(frame);
      } catch (e) {
        console.error('[WechatRealtime] 协议帧解析异常:', e, text);
      }
    });

    // 连接关闭
    this.socketTask.onClose((res) => {
      console.warn('[WechatRealtime] Socket 已关闭:', res.code, res.reason);
      this.cleanup();
      if (!this.isManualClose) {
        this.scheduleReconnect();
      }
    });

    // 发生网络错误
    this.socketTask.onError((err) => {
      console.error('[WechatRealtime] Socket 报错:', err);
      this.cleanup();
      if (!this.isManualClose) {
        this.scheduleReconnect();
      }
    });
  }

  /**
   * 处理网关响应帧
   */
  private handleCentrifugoFrame(frame: any) {
    // 1. 握手应答 (Connect Response)
    if (frame.connect) {
      this.clientId = frame.connect.client;
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.info('[WechatRealtime] 网关握手成功! ClientId:', this.clientId);

      // 开启本地保活心跳 (每 25 秒探测一次，防止微信 60s 闲置切断)
      this.startHeartbeat();

      // 重新订阅之前注册的频道
      this.resubscribeAll();
      return;
    }

    // 2. 接收服务端推送 (Publication Push)
    if (frame.pub) {
      const channel = frame.channel;
      const envelope = frame.pub.data as RealtimeEnvelope;
      const callbacks = this.subscriptions.get(channel) || [];
      callbacks.forEach((cb) => cb(envelope));
      return;
    }
  }

  /**
   * 订阅个人专属通知频道 (user#userId) - 免申请 Token
   */
  public subscribeUser(userId: string, onMessage: (envelope: RealtimeEnvelope) => void) {
    const channel = `user#${userId}`;
    this.registerCallback(channel, onMessage);

    if (this.isConnected) {
      this.sendFrame({
        id: this.commandId++,
        subscribe: { channel },
      });
    }
  }

  /**
   * 订阅协同房间频道 (room:roomId) - 动态向业务端申请 Token
   */
  public async subscribeRoom(roomId: string, onMessage: (envelope: RealtimeEnvelope) => void): Promise<void> {
    const channel = `room:${roomId}`;
    this.registerCallback(channel, onMessage);

    if (!this.isConnected || !this.clientId) {
      // 若尚未连接就绪，将在握手成功后的 resubscribeAll 中自动触发
      return;
    }

    const subToken = await this.fetchSubscriptionToken(channel, this.clientId);
    this.sendFrame({
      id: this.commandId++,
      subscribe: {
        channel,
        token: subToken,
      },
    });
  }

  private registerCallback(channel: string, cb: (env: RealtimeEnvelope) => void) {
    const list = this.subscriptions.get(channel) || [];
    list.push(cb);
    this.subscriptions.set(channel, list);
  }

  private async resubscribeAll() {
    for (const [channel] of this.subscriptions.entries()) {
      if (channel.startsWith('user#')) {
        this.sendFrame({ id: this.commandId++, subscribe: { channel } });
      } else if (channel.startsWith('room:') && this.clientId) {
        try {
          const token = await this.fetchSubscriptionToken(channel, this.clientId);
          this.sendFrame({ id: this.commandId++, subscribe: { channel, token } });
        } catch (e) {
          console.error(`[WechatRealtime] 恢复订阅频道 ${channel} 失败:`, e);
        }
      }
    }
  }

  private sendFrame(obj: any) {
    if (this.socketTask) {
      this.socketTask.send({
        data: JSON.stringify(obj),
      });
    }
  }

  private sendPing() {
    if (this.socketTask) {
      this.socketTask.send({ data: '{}' });
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingIntervalTimer = setInterval(() => {
      this.sendPing();
    }, 25000) as unknown as number;
  }

  private stopHeartbeat() {
    if (this.pingIntervalTimer) {
      clearInterval(this.pingIntervalTimer);
      this.pingIntervalTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    // 指数退避重连算法: min(1000 * 2^attempts, 20000)
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 20000);
    console.info(`[WechatRealtime] 将在 ${delay}ms 后进行第 ${this.reconnectAttempts} 次重连...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay) as unknown as number;
  }

  private cleanup() {
    this.isConnected = false;
    this.clientId = null;
    this.stopHeartbeat();
    this.socketTask = null;
  }

  public disconnect() {
    this.isManualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    if (this.socketTask) {
      this.socketTask.close({ code: 1000, reason: 'Manual Disconnect' });
    }
  }

  private fetchConnectionToken(): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const token = await this.options.getAuthToken();
      wx.request({
        url: `${this.options.apiBaseUrl}/v1/realtime/token`,
        method: 'GET',
        header: { Authorization: `Bearer ${token}` },
        success: (res) => {
          if (res.statusCode === 200) {
            resolve((res.data as any).token);
          } else {
            reject(new Error(`获取 Connection Token 失败: HTTP ${res.statusCode}`));
          }
        },
        fail: reject,
      });
    });
  }

  private fetchSubscriptionToken(channel: string, client: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const token = await this.options.getAuthToken();
      wx.request({
        url: `${this.options.apiBaseUrl}/v1/realtime/subscribe`,
        method: 'POST',
        header: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        data: { channel, client },
        success: (res) => {
          if (res.statusCode === 200) {
            resolve((res.data as any).token);
          } else {
            reject(new Error(`获取 Subscription Token 失败: HTTP ${res.statusCode}`));
          }
        },
        fail: reject,
      });
    });
  }
}
```

---

## 5. Bruno API & WebSocket 全链路测试指南 (Bruno Testing Suite)

Centrifugo 使用基于 JSON 的协议帧通信。借助 [Bruno](https://www.usebruno.com/) API 客户端，无需编写复杂的前端页面即可完整闭环测试**用户认证 -> 长连接握手 -> 私有频道订阅鉴权（Proxy Webhook / Token） -> 实时消息接收**全流程。

### 5.1 环境变量配置 (Bruno Environment)

在 Bruno 集合中创建环境（如 `Development`），配置以下变量：

| 变量名 | 初始值 / 示例值 | 说明 |
| :--- | :--- | :--- |
| `baseUrl` | `http://localhost:3000` | NestJS 业务服务 HTTP 基础地址 |
| `wsUrl` | `ws://localhost:8000/connection/websocket` | Centrifugo 物理 WebSocket 连接地址 |
| `email` | `admin@example.com` | 测试用户登录邮箱 |
| `password` | `Admin123456!` | 测试用户登录密码 |
| `bearerToken` | `""` | 业务认证 Token（登录接口自动填充） |
| `userId` | `""` | 当前登录用户 UUID（登录接口自动填充） |
| `realtimeToken` | `""` | Centrifugo 长连接凭证（获取 Token 接口自动填充） |
| `subscriptionToken` | `""` | 私有频道准入凭证（模式 B 换票接口自动填充） |

---

### 5.2 阶段一：REST API 认证与凭据获取流水线

在 Bruno 中创建以下 4 个 HTTP 请求，利用 Bruno **Post Response Script** 实现全自动无感变量传递：

#### 请求 1：用户登录 (`POST /v1/auth/sign-in/email`)

- **URL**: `{{baseUrl}}/v1/auth/sign-in/email`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body**:

  ```json
  {
    "email": "{{email}}",
    "password": "{{password}}"
  }
  ```

- **Post Response Script** (Tests tab):

  ```javascript
  const data = res.getBody();
  if (data.token) {
    bru.setEnvVar('bearerToken', data.token);
  }
  if (data.user?.id) {
    bru.setEnvVar('userId', data.user.id);
  }
  ```

#### 请求 2：获取长连接 Connection Token (`GET /v1/realtime/token`)

- **URL**: `{{baseUrl}}/v1/realtime/token?protocol=websocket`
- **Method**: `GET`
- **Headers**:
  - `Authorization`: `Bearer {{bearerToken}}`
- **Post Response Script**:

  ```javascript
  const data = res.getBody();
  if (data.token) {
    bru.setEnvVar('realtimeToken', data.token);
  }
  if (data.url) {
    bru.setEnvVar('wsUrl', data.url);
  }
  ```

#### 请求 3 (单元测试/免长连接直测)：模拟 Centrifugo Proxy Webhook 鉴权 (`POST /v1/realtime/proxy/subscribe`)

> 💡 **开发者福利**：无需启动 Centrifugo 容器即可在本地直接验证 NestJS 后端频道授权规则是否符合预期！
- **URL**: `{{baseUrl}}/v1/realtime/proxy/subscribe`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body**:

  ```json
  {
    "client": "mock-bruno-client-01",
    "transport": "websocket",
    "protocol": "json",
    "encoding": "json",
    "user": "{{userId}}",
    "channel": "admin:system-metrics",
    "data": {
      "email": "{{email}}",
      "role": "admin"
    }
  }
  ```

- **断言与预期**：
  - 授权通过：返回 `HTTP 200`，Body 为 `{"result": {}}`
  - 权限拒绝：返回 `HTTP 200`，Body 为 `{"error": {"code": 103, "message": "Permission denied"}}`

#### 请求 4 (备用换票模式)：申请私有频道 Subscription Token (`POST /v1/realtime/subscribe`)

- **URL**: `{{baseUrl}}/v1/realtime/subscribe`
- **Method**: `POST`
- **Headers**:
  - `Authorization`: `Bearer {{bearerToken}}`
  - `Content-Type`: `application/json`
- **Body**:

  ```json
  {
    "channel": "room:general",
    "client": "mock-bruno-client-01"
  }
  ```

- **Post Response Script**:

  ```javascript
  const data = res.getBody();
  if (data.token) {
    bru.setEnvVar('subscriptionToken', data.token);
  }
  ```

---

### 5.3 阶段二：Bruno WebSocket 实时长连接测试交互

在 Bruno 中创建 **WebSocket Request**，填入 URL: `{{wsUrl}}`（如 `ws://localhost:8000/connection/websocket`）。点击 **Connect** 连接成功后，在消息输入框中依次发送如下标准协议帧：

#### 步骤 1：发送 Connect 握手帧

向网关发送由上一步自动获取的 `{{realtimeToken}}`：

```json
{
  "id": 1,
  "connect": {
    "token": "{{realtimeToken}}"
  }
}
```

**网关正常应答**：

```json
{
  "id": 1,
  "connect": {
    "client": "550e8400-e29b-41d4-a716-446655440000",
    "version": "5.4.0",
    "ping": 25,
    "pong": true
  }
}
```

#### 步骤 2：订阅个人专属通道 (`user#${userId}`) - 原生零票据

```json
{
  "id": 2,
  "subscribe": {
    "channel": "user#{{userId}}"
  }
}
```

**网关正常应答**：

```json
{
  "id": 2,
  "subscribe": {
    "recovered": false
  }
}
```

#### 步骤 3：订阅受控私有频道 (模式 A：Proxy Webhook 自动鉴权)

> 无需携带 `token`，Centrifugo 网关将自动回调 NestJS 后端执行 `@ChannelAuth` 规则校验：

```json
{
  "id": 3,
  "subscribe": {
    "channel": "admin:system-metrics"
  }
}
```

**网关应答 (若用户具备管理员权限)**：

```json
{
  "id": 3,
  "subscribe": {
    "recovered": false
  }
}
```

#### 步骤 4：订阅受控私有频道 (模式 B：Subscription Token 换票模式)

携带通过 `/v1/realtime/subscribe` 换取的 `{{subscriptionToken}}`：

```json
{
  "id": 4,
  "subscribe": {
    "channel": "room:general",
    "token": "{{subscriptionToken}}"
  }
}
```

#### 步骤 5：接收服务端事件推送信封 (Server Publication)

当后端调用 `realtimeService.sendToUser(...)` 或 `realtimeService.broadcast(...)` 时，Bruno 会即时捕获到推送帧：

```json
{
  "pub": {
    "data": {
      "event": "notification",
      "targetUserId": "01918342-9999-7000-8000-000000000001",
      "data": {
        "id": "notif_1001",
        "title": "工单处理进度更新",
        "unreadCount": 1
      },
      "timestamp": 1756140800000
    }
  },
  "channel": "user#01918342-9999-7000-8000-000000000001"
}
```

#### 步骤 6：心跳探测保活 (Ping / Pong)

Centrifugo 服务端将按设定的周期（默认 25 秒）自动向客户端下发空对象 `{}`，Bruno 客户端回复 `{}` 即可完成心跳刷新。

---

## 6. 错误码与排障矩阵 (Error Codes & Troubleshooting)

### 6.1 Centrifugo 网关错误码 (100~110)

| 错误码 | 错误名称 | 发生原因 | 推荐排查与恢复动作 |
| :--- | :--- | :--- | :--- |
| **100** | `Internal Error` | 网关内部异常或 Redis 引擎通信中断 | 检查 Centrifugo 服务端日志及 Redis 容器连通性。 |
| **102** | `Bad Request` | 连接参数格式错误或缺失必需字段 | 检查握手 URL、Token 结构与 JSON 序列化格式。 |
| **103** | `Unknown Channel / Permission Denied` | 订阅了网关未放行的非法频道前缀，或 Proxy Webhook 回调拒绝 | 1. 检查频道命名；2. 若为受控频道，检查 NestJS 后端 `@ChannelAuth` 是否拒绝或抛错。 |
| **105** | `Channel Limit Exceeded` | 单连接订阅频道数超过网关上限 (默认 128) | 检查客户端是否存在死循环订阅或重复订阅未注销的内存泄漏。 |
| **109** | `Token Expired` | Connection 或 Subscription JWT 已过期 | 重新调用业务 API 获取新鲜 Token 并发起重连。 |
| **110** | `Expired` | 长连接因心跳超时断开 | SDK 内部会自动重连；移动端注意排查后台休眠对网络心跳的冻结。 |

---

### 6.2 WebSocket 断开状态码 (3000~3503)

| Close Code | 含义 | 是否自动重连 | 客户端说明与处理 |
| :--- | :--- | :--- | :--- |
| **3000** | `Normal Disconnect` | 否 | 客户端主动调用 `client.disconnect()` 关闭连接。 |
| **3001** | `Shutdown` | 是 | 网关服务器优雅重启或维护，客户端自动退避重连。 |
| **3501** | `Force Disconnect` | 否 | 用户被管理员在后台强制下线，**客户端应清理本地认证状态并跳转登录页**。 |
| **3502** | `Force User Disconnect`| 否 | 同一账号在其他设备登录或密码变更失效，提示用户重新登录。 |
| **3503** | `Session Expired` | 否 | 用户业务 Session 会话过期，需刷新登录凭据。 |

---

### 6.3 常见排障场景自查清单

1. **Proxy Webhook 鉴权报错 103 (Permission Denied)**：
   - 检查 `deploy/centrifugo/config.yaml` 中 `proxy_subscribe_endpoint` 是否指向正确的 NestJS 实例地址（Docker 容器网络通常为 `http://app:3000/v1/realtime/proxy/subscribe`，本地直跑为 `http://localhost:3000/v1/realtime/proxy/subscribe`）；
   - 在 NestJS 服务端查看日志 `[Realtime] Centrifugo Proxy 订阅鉴权拒绝`，确认是否缺失对应频道的 `@ChannelAuth` 规则；
   - 本地可直接在 Bruno 中调用 `POST /v1/realtime/proxy/subscribe` 单独排查后端业务规则。

2. **获取 Connection Token 报错 401 Unauthorized**：
   - 检查请求头 `Authorization: Bearer {{bearerToken}}` 是否有效；
   - 确认 Better Auth 会话尚未过期，可重新触发登录请求刷新 `bearerToken`。

3. **连接网关报 WebSocket Connection Failed**：
   - 本地开发确保通过 `just realtime` 启动了独立 Centrifugo 容器；
   - 运行 `just realtime-health` 检查网关运行状态。
