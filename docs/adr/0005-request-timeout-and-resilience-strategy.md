# ADR 0005: 双轨协作式超时拦截与出站弹性容错策略 (Dual-Track Cooperative Timeout and Resilience Strategy)

## 状态 (Status)

已接受 (Accepted) — 2026-09-11

## 背景 (Context)

在 NestJS (Fastify 5 + Node 24 纯 ESM) 企业级后端中，请求生命周期超时与容错治理存在以下关键挑战：

1. **RxJS Timeout 的假象与幽灵计算 (Ghost Execution)**：
   NestJS 官方文档经典的 `pipe(timeout(ms))` 仅在 Observable 层面取消了前端客户端的等待，并抛出 `408 RequestTimeoutException`。然而，底层由 JavaScript Promise 承载的长耗时数据库慢查询（Drizzle/PostgreSQL）、大文件处理或外部 HTTP 调用依然在后台持续执行，不仅霸占事件循环，而且极易导致数据库连接池耗尽与雪崩。
2. **连接断开与下游资源泄漏 (Client Disconnection)**：
   当用户在移动端关闭页面、弱网断开或反向代理网关提前超时时，传统的服务端逻辑无法感知连接已断，继续做无用功。
3. **容错治理与 Cockatiel 的生态位混淆**：
   社区部分实践试图将 Cockatiel（.NET Polly 移植版）直接作为 NestJS 全局 HTTP 拦截器。然而，在入站请求层进行重试（Retry）极度危险（极易重放非幂等 POST/PATCH 请求造成资金或状态污染），且入站并发限流与超时已有反向代理与 Fastify 专门组件。Cockatiel 的真正杀伤力在于**出站网络 I/O（第三方依赖/RPC/S3/支付/AI调用）**的故障隔离与弹性自愈。

## 决策 (Decision)

### 1. 入口层：双轨协作式超时拦截器 (Dual-Track Cooperative TimeoutInterceptor)

- **双轨机制**：
  - **轨道一（响应信封）**：基于 RxJS `timeout({ each: ms, with: () => throwError(...) })` 触发标准的 `RequestTimeoutException`（408），交由全局 `HttpExceptionFilter` 输出统一错误响应。
  - **轨道二（级联取消）**：在拦截器内部针对每个 HTTP 请求绑定 `AbortController`。将该 Controller 与 Fastify 请求连接的提前关闭事件（`req.raw.on('close')`）以及超时触发点联合绑定。一旦发生超时或客户端主动断链，立即执行 `abortController.abort(new Error('Request Timeout / Client Disconnected'))`。
- **动态声明装饰器**：
  - 提供 `@SetTimeout(ms)` / `@Timeout(ms)` 装饰器与 `Reflector`，支持控制器或单个端点覆写默认超时窗口（默认：15,000ms）。

### 2. 信号传播层：显式 `@ReqSignal()` 参数装饰器

- 提供简洁清晰的 `@ReqSignal(): ParameterDecorator` 参数装饰器，Controller 端点按需注入标准 `AbortSignal`；
- 业务方法可直接将 `signal` 传递给下游出站 `fetch(url, { signal })`、异步延迟、或感知取消的数据库客户端，实现端到端的协作式取消（Cooperative Cancellation）。

### 3. 出站层：Cockatiel 专职用于第三方依赖与外部 I/O 弹性治理

- **红线规定**：严禁将 Cockatiel 用于全局 HTTP 入口拦截器。
- **适用场景**：封装至出站 Service（如第三方支付网关、邮件传输、S3 对象存储、大语言模型 API 调用等），针对网络抖动进行带抖动的退避重试（Exponential Backoff with Jitter）、慢调用熔断（Circuit Breaker）、并发仓壁隔绝（Bulkhead）与优雅降级（Fallback）。

## 后果 (Consequences)

### 正面收益

- **杜绝幽灵计算与连接池枯竭**：前端超时或断连时，取消信号立即级联传递至下游，主动释放正在进行的外部 HTTP 请求与可中断操作；
- **职责边界清晰**：入站请求由 Fastify + 双轨 TimeoutInterceptor 精准兜底，出站调用由 Cockatiel / 标准 Fetch 负责弹性容错；
- **契合 Node.js 24 现代规范**：全面拥抱 Web 标准 `AbortController` 与 `AbortSignal`，零黑魔法，跨平台与跨框架兼容。

### 负面代价与约束

- 需要开发者在编写耗时外部 I/O 与可中断异步方法时，主动接受并传递 `signal: AbortSignal`；
- 极少数老旧不支持 `AbortSignal` 的第三方 SDK 仍需等待其自然返回或通过竞态包装（`Promise.race`）防御。
