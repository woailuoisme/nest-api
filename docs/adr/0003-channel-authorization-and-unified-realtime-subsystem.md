# ADR 0003: 统一实时中枢子系统与模式匹配频道动态鉴权 (Unified Realtime Subsystem & Channel Authorization)

## 状态 (Status)

已接受 (Accepted) — 2026-08-28

## 背景 (Context)

随着系统中实时业务场景的扩展（系统监控指标、用户专属通知、实时订单追踪等），早期散落在各业务模块中的长连接实现产生了多处架构摩擦：

1. **职责倒置与概念污染**：通用 SSE 订阅被塞入 `modules/notifications`，导致非通知事件被迫伪装为通知；WebSocket 被塞入 `modules/dashboard`，导致通用用户事件必须连接监控命名空间。
2. **私有频道无准入管控**：客户端加入 Socket.IO 房间时缺乏精细化授权机制，任意认证用户均可监听其他用户的专属消息房间。
3. **物理分层困惑**：是否应将实时通信下沉至 `src/common/realtime`，或是拆分为水平层级？

## 决策 (Decision)

1. **收敛为顶级自包含子系统 (`src/realtime/`)**：
   - 保持 `src/realtime/` 与 `src/queues/`、`src/schedules/` 并列为顶级架构子系统，内部垂直组织 `transports/`（SSE / WebSocket / Redis 广播）、`guards/`（握手守卫）与 `channels/`（频道鉴权）。
   - 不横向拆散至 `src/common`，保障高内聚与代码局域性（Locality）。
2. **模式匹配式频道动态鉴权 (Channel Authorization)**：
   - 引入 `ChannelManager` 对齐 Laravel `routes/channels.php` 的私有频道权限体系。
   - 提供参数化模式（如 `private:user.{userId}`）与通配模式（如 `private:admin.*`），客户端订阅房间时由网关统一进行动态权限校验，未授权请求予以 403 阻断。
3. **统一客户端单一握手端点**：
   - WebSocket 统一定位于 `/realtime`，SSE 统一定位于 `GET /v1/realtime/stream`。不同业务领域通过逻辑房间（Rooms）多租户隔离，前端仅需维护单一长连接。
4. **平滑演进与业务模块纯化**：
   - `modules/notifications` 专注于通知业务本身，旧流式端点标记为 `@deprecated` 并委托给实时中枢；
   - `modules/dashboard` 专注于指标采集并通过 `RealtimeService.broadcast('dashboard:system', ...)` 广播。

## 后果 (Consequences)

- **正面收益**：
  - 业务模块彻底摆脱长连接、HTTP 流、握手鉴权与心跳保活样板代码；
  - 客户端长连接由多条物理通道收敛为单一复用连接，降低移动端耗电与服务端 TCP 握手开销；
  - 私有频道具备严格的权限校验，防止越权监听敏感业务数据；
  - 集群多 Pod 环境下基于 Redis Pub/Sub 透明广播，无状态水平扩容。
- **负面代价**：
  - 前端需要将旧有的 `/dashboard` Socket 命名空间和 `/v1/notifications/stream` 迁移为统一的 `/realtime` 端点与频道订阅指令。
