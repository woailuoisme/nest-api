import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPinoLogger } from '@/setup/logger/logger.config';

const captureException = vi.fn();
const captureMessage = vi.fn();

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  getClient: vi.fn(() => ({})), // 已初始化 → 桥接生效
  captureException: (...args: unknown[]) => captureException(...args),
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

describe('Pino → Sentry 桥接', () => {
  beforeEach(() => {
    captureException.mockClear();
    captureMessage.mockClear();
  });

  async function createLogger() {
    const destination = new PassThrough();
    // 消费写入，避免流缓冲导致挂起
    destination.resume();
    return createPinoLogger(destination);
  }

  it('error 级传入 Error 时按异常上报（保留堆栈）', async () => {
    const logger = await createLogger();
    const error = new Error('boom');

    logger.error(error);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][0]).toBe(error);
  });

  it('error 级传入对象/字符串时按消息上报', async () => {
    const logger = await createLogger();

    logger.error({ orderId: 'a1' }, '创建订单失败');

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, level] = captureMessage.mock.calls[0];
    expect(message).toContain('创建订单失败');
    expect(message).toContain('orderId');
    expect(level).toBe('error');
  });

  it('info 及以下级别不上报（非错误路径零开销）', async () => {
    const logger = await createLogger();

    logger.info('普通信息');
    logger.debug('调试信息');
    logger.warn('警告');

    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
