import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 请求上下文数据模型 (Request Context Store)
 */
export interface RequestContextData {
  /** 唯一请求追踪标识 (x-request-id) */
  requestId: string;
  /** 请求进入服务器的初始毫秒时间戳 */
  startTime: number;
  /** 绝对截止毫秒时间戳 (Deadline Timestamp = now + timeoutMs) */
  deadline?: number;
  /** 协作取消信号 (AbortSignal) */
  signal?: AbortSignal;
  /** 是否为长连接/流式响应 (如 SSE / WebSocket) */
  isStreaming?: boolean;
  /** 自定义扩展元数据存储 */
  metadata?: Record<string, unknown>;
}

/**
 * 生产级异步请求上下文管理器 (Enterprise RequestContext via AsyncLocalStorage)
 *
 * 遵循 Envoy / Google gRPC Context 标准设计：
 * - 基于 Node.js 原生 AsyncLocalStorage 贯穿全链路异步微任务/宏任务；
 * - 支持全局提取 AbortSignal，免去在 Controller -> Service 之间逐层传参的样板代码；
 * - 支持全链路 Deadline 预算传播 (Remaining Timeout Budget)，当下游调用前预算已耗尽时快速短路；
 * - 原生支持独立 Worker、CLI 命令与单元测试沙盒 (RequestContext.run)。
 */
const storage = new AsyncLocalStorage<RequestContextData>();

export const RequestContext = {
  /**
   * 获取当前上下文快照
   */
  get current(): RequestContextData | undefined {
    return storage.getStore();
  },

  /**
   * 获取当前请求的协作取消信号
   */
  getSignal(): AbortSignal | undefined {
    return storage.getStore()?.signal;
  },

  /**
   * 获取当前请求唯一的追踪 ID
   */
  getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  },

  /**
   * 计算当前请求距离截止时间 (Deadline) 的剩余可用预算毫秒数
   *
   * @returns 剩余毫秒数 (长连接或无限制返回 POSITIVE_INFINITY；未配置 Deadline 返回 undefined；若已超期返回 0)
   */
  getRemainingMs(): number | undefined {
    const store = storage.getStore();
    if (!store) {
      return undefined;
    }
    if (store.isStreaming || (store.deadline !== undefined && store.deadline <= 0)) {
      return Number.POSITIVE_INFINITY;
    }
    if (store.deadline === undefined) {
      return undefined;
    }
    return Math.max(0, store.deadline - Date.now());
  },

  /**
   * 判断当前上下文是否已超时或已被主动取消
   */
  hasExpired(): boolean {
    const store = storage.getStore();
    if (!store) {
      return false;
    }
    if (store.signal?.aborted) {
      return true;
    }
    if (store.deadline && store.deadline > 0 && Date.now() >= store.deadline) {
      return true;
    }
    return false;
  },

  /**
   * 动态更新/绑定当前上下文的 Deadline 预算与取消信号
   */
  setDeadline(timeoutMs: number, signal?: AbortSignal): void {
    const store = storage.getStore();
    if (!store) {
      return;
    }
    if (timeoutMs > 0) {
      store.deadline = Date.now() + timeoutMs;
    } else {
      store.deadline = 0;
    }
    if (signal) {
      store.signal = signal;
    }
  },

  /**
   * 标记当前请求为长连接流式端点 (免除超时强杀)
   */
  setStreaming(isStreaming = true): void {
    const store = storage.getStore();
    if (store) {
      store.isStreaming = isStreaming;
    }
  },

  /**
   * 在独立的上下文环境中执行异步回调函数
   * 适用于 Fastify onRequest 中间件、BullMQ 消费 Worker、CLI 批处理或单测沙盒
   */
  run<R>(data: RequestContextData, fn: () => R): R {
    return storage.run(data, fn);
  },
};
