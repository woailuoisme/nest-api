# ADR 0006: 入站自适应负载脱落与出站 Cockatiel 弹性治理体系 (Inbound Load Shedding and Outbound Cockatiel Resilience Pipeline)

## 状态 (Status)

已接受 (Accepted) — 2026-09-11

## 背景 (Context)

在现代高并发企业级服务中，服务崩溃与雪崩往往源于两类不对称压力：

1. **入站流量洪峰压垮事件循环 (Inbound Saturation)**：
   Node.js 的单线程事件循环特性使其对主线程延迟极度敏感。当突发流量冲垮系统时，大量微任务与 I/O 回调排队导致事件循环延迟（Event Loop Delay）飙升、堆内存占用过高并最终触发 OOM 宕机。如果不进行**自适应负载脱落（Load Shedding）**，存量正在执行的请求与新请求将全部超时代价惨重。
2. **出站外部依赖级联雪崩 (Outbound Dependency Failures)**：
   当代系统重度依赖下游微服务、第三方支付网关（Stripe）、S3 存储与外部 API。当下游服务变慢或故障时，调用方若盲目重发请求，将导致自身 HTTP 连接池迅速枯竭，引发跨服务级联雪崩。需要具备包括**重试退避 (Retry)**、**断路器 (Circuit Breaker)**、**仓壁隔离 (Bulkhead)**、**调用超时 (Timeout)** 与 **优雅降级 (Fallback)** 的出站弹性治理管道。

## 决策 (Decision)

### 1. 统一弹性治理子系统 (`src/common/resilience/`)

- 建立 `@Global()` 全局模块 `ResilienceModule`，清晰划分入站自适应脱落与出站外部调用治理边界。

### 2. 入站自适应负载脱落 (`LoadSheddingGuard`)

- **双核心动态指标采样**：
  - **事件循环延迟 (Event Loop Delay)**：通过 Node.js 原生 `node:perf_hooks` 的 `monitorEventLoopDelay` 高精度直方图采样，当 P95 超过 150ms 警戒线时判定为严重排队；
  - **堆内存水位 (Heap Usage)**：检测 `process.memoryUsage().heapUsed / heapTotal`，超过 85% 警戒线判定为内存告急。
- **过载保护行为**：
  - 主动拒绝新进入的请求，快速抛出 `ServiceUnavailableException`（503），并在 HTTP 响应头注入 `Retry-After: 5`，保护已有在途请求平稳完成；
  - 提供 `@BypassLoadShedding()` 装饰器，豁免 `/health` 健康检查与关键管理面端点，防止负载脱落导致 K8s 探针误杀 Pod。

### 3. 出站 Cockatiel 弹性治理管道 (`ResilienceRegistryService` + `@Resilient` / `@CircuitBreaker`)

- **引擎选型**：引入微软工程师开源的 TypeScript 专业弹性工程库 **`cockatiel@4.0.0`**（灵感源于 .NET Polly），实现工业级韧性编排。
- **Polly 经典金字塔防御顺序 (Execution Pipeline)**：
  - `[外] Fallback -> Retry (指数退避+Jitter抖动) -> CircuitBreaker -> Bulkhead (并发配额) -> Timeout [内]`。
  - 最外层捕获重试耗尽、熔断跳闸 (`BrokenCircuitError`)、仓壁打满 (`BulkheadRejectedError`) 与超时错误，无缝路由至 Fallback 降级。
- **状态生命周期管理**：
  - 全局单例注册中心 `ResilienceRegistryService` 统一维护命名 Policy，确保断路器状态和仓壁配额跨请求准确累积与共享；
  - 自动绑定项目原生 Pino 日志（`onBreak`, `onReset`, `onHalfOpen`, `onRetry`, `onReject`）。
- **双模使用体验**：
  - 编程式：`this.circuitBreakerService.execute('stripe-charge', () => apiCall(), options)`；
  - 声明式：支持全功能复合装饰器 `@Resilient(options)` 以及快捷断路器装饰器 `@CircuitBreaker(options)`。

## 后果 (Consequences)

- **正面收益**：
  - 入站和出站职责清晰解耦：入站利用 Node 24 原生底座做零损耗脱落，出站借助 cockatiel 编排复杂的分布式容错管道；
  - 策略支持指数退避、防惊群抖动（Jitter）、并发限制与采样率熔断，达到金融级和工业级可靠性；
  - 状态流转与重试全链路输出 Pino 结构化日志，实时指标通过 `getStats()` 对外暴露。
- **负面代价**：
  - 引入了 `cockatiel` 依赖（纯 TS，零其他传递依赖，符合 ESM 规范）；
  - 业务开发者在定义关键出站链路时需合理权衡重试次数与断路器冷却时间，避免在半开状态下瞬间产生过载。
