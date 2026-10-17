import { describe, expect, it } from 'vitest';

import { RequestContext } from '@/common/context';

describe('RequestContext (请求级异步上下文与全链路截止时间追踪)', () => {
  it('场景 1: 在未初始化上下文的孤立环境中调用应安全返回 undefined 或默认值', () => {
    expect(RequestContext.current).toBeUndefined();
    expect(RequestContext.getRequestId()).toBeUndefined();
    expect(RequestContext.getSignal()).toBeUndefined();
    expect(RequestContext.getRemainingMs()).toBeUndefined();
    expect(RequestContext.hasExpired()).toBe(false);
  });

  it('场景 2: RequestContext.run 正确隔离不同异步链路中的上下文数据', async () => {
    const taskA = RequestContext.run({ requestId: 'req-A', startTime: Date.now() }, async () => {
      await new Promise((res) => setTimeout(res, 10));
      expect(RequestContext.getRequestId()).toBe('req-A');
      return RequestContext.getRequestId();
    });

    const taskB = RequestContext.run({ requestId: 'req-B', startTime: Date.now() }, async () => {
      await new Promise((res) => setTimeout(res, 5));
      expect(RequestContext.getRequestId()).toBe('req-B');
      return RequestContext.getRequestId();
    });

    const [resA, resB] = await Promise.all([taskA, taskB]);
    expect(resA).toBe('req-A');
    expect(resB).toBe('req-B');
    expect(RequestContext.current).toBeUndefined();
  });

  it('场景 3: 截止时间与剩余超时预算 (getRemainingMs / hasExpired) 计算', async () => {
    await RequestContext.run({ requestId: 'req-budget', startTime: Date.now() }, async () => {
      const controller = new AbortController();
      RequestContext.setDeadline(100, controller.signal);

      expect(RequestContext.getSignal()).toBe(controller.signal);
      expect(RequestContext.hasExpired()).toBe(false);

      const remaining = RequestContext.getRemainingMs();
      expect(remaining).toBeDefined();
      expect(remaining!).toBeGreaterThan(50);
      expect(remaining!).toBeLessThanOrEqual(100);

      // 等待 110ms 超时
      await new Promise((res) => setTimeout(res, 110));
      expect(RequestContext.getRemainingMs()).toBe(0);
      expect(RequestContext.hasExpired()).toBe(true);
    });
  });

  it('场景 4: 流式长连接 (isStreaming) 场景下剩余预算为 Infinity 且永不判定为过期', async () => {
    await RequestContext.run({ requestId: 'req-stream', startTime: Date.now() }, () => {
      RequestContext.setStreaming(true);
      expect(RequestContext.getRemainingMs()).toBe(Number.POSITIVE_INFINITY);
      expect(RequestContext.hasExpired()).toBe(false);
    });
  });

  it('场景 5: setDeadline 传入 <= 0 时视为长连接或禁用超时', async () => {
    await RequestContext.run({ requestId: 'req-no-timeout', startTime: Date.now() }, () => {
      RequestContext.setDeadline(0);
      expect(RequestContext.getRemainingMs()).toBe(Number.POSITIVE_INFINITY);
      expect(RequestContext.hasExpired()).toBe(false);
    });
  });
});
