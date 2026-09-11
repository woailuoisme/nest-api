# ADR 0004: 可插拔 Pusher / Soketi 工业级实时长连接驱动 (Pluggable Pusher/Soketi Realtime Driver)

## 状态 (Status)

已接受 (Accepted) — 2026-08-28

## 背景 (Context)

在 ADR 0002 与 ADR 0003 中，我们构建了统一的实时中枢子系统与基于模式匹配的私有频道鉴权机制。但在大规模生产与高并发场景下：

1. **应用进程长连接绑定问题**：若所有客户端 WebSocket 长连接均直接挂载在 Node.js / Fastify 应用进程内部，后端服务滚动发布、重启或扩容时将导致成千上万在线客户端同时断线重连，引发雪崩式重连冲击；
2. **Node.js 事件循环与内存开销**：单机维持 10 万+ 活跃连接会占用大量应用内存，并增加垃圾回收与事件循环延迟；
3. **业界工业级最佳实践**：以 Laravel Reverb、Soketi、Pusher 为代表的工业级方案采用「后端无状态触发者 + 高性能长连接专用网关」解耦架构。

## 决策 (Decision)

1. **可插拔双驱动架构 (Pluggable Dual-Driver)**：
   - 保持 `RealtimeService` 极简门面（`sendToUser`、`broadcast`）对业务层 100% 透明；
   - **Local 驱动（开发/测试）**：继续保留内嵌 Socket.IO + SSE + Redis Pub/Sub，免外部依赖，单机即跑；
   - **Pusher 驱动（生产高并发）**：后端通过官方 `pusher` SDK 向独立部署的 Soketi (uWebSockets.js C++ 引擎) 或 Pusher 托管集群触发事件，后端进程彻底无状态化。
2. **统一单一 URL 配置规范**：
   - `BROADCAST_DRIVER="local" | "pusher"`
   - `REALTIME_URL="pusher://key:secret@host:port/appId?cluster=...&useTls=..."`，对齐项目核心连接收敛规范。
3. **Pusher 协议私有频道鉴权与规则复用**：
   - 暴露 `POST /v1/realtime/auth` 与 `POST /broadcasting/auth`（兼容 Laravel Echo / pusher-js 默认行为）；
   - 完整复用 `ChannelManager` 规则引擎，规则一次编写，跨驱动共享；
   - 透明双向兼容 `private:user.42` 与 Pusher 强制的 `private-user.42`。

## 后果 (Consequences)

- **正面收益**：
  - 生产环境发布重启后端应用实现用户连接零中断；
  - 大幅卸载 Node.js 应用进程内存与连接数负担；
  - 前端可直接利用全球成熟的 `pusher-js` 与 `laravel-echo` SDK。
- **负面代价**：
  - 生产环境启用 Pusher 驱动时，需额外运行 1 个 Soketi Docker 容器或配置 Pusher SaaS 凭据。
