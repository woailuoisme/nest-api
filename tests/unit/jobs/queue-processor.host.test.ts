import { WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { QUEUE_DEFAULT_JOB_OPTIONS } from '@/database/bull.config';
import { DemoProcessor } from '@/jobs/demo/demo.processor';
import { MediaProcessor } from '@/jobs/media/media.processor';
import { QueueProcessorHost } from '@/jobs/queue-processor.host';
import { SearchProcessor } from '@/jobs/search/search.processor';
import { TokenCleanupProcessor } from '@/jobs/token-cleanup/token-cleanup.processor';

/** `@nestjs/bullmq` 内部元数据键（未公开导出，此处固化以守护装饰器被误删） */
const ON_WORKER_EVENT_METADATA = 'bullmq:worker_events_metadata';

/** 直接实例化基类用于调用事件处理器（不需要真实 Redis） */
class ProbeProcessor extends QueueProcessorHost {
  async process(): Promise<void> {}
}

describe('QueueProcessorHost — BullMQ 事件兜底', () => {
  it('全部 processor 都应继承统一基类（保证 error 事件始终有监听）', () => {
    for (const processor of [DemoProcessor, MediaProcessor, SearchProcessor, TokenCleanupProcessor]) {
      expect(Object.getPrototypeOf(processor.prototype)).toBe(QueueProcessorHost.prototype);
    }
  });

  it('基类必须仍是 WorkerHost 子类（@nestjs/bullmq 的 instanceof 校验）', () => {
    expect(new ProbeProcessor()).toBeInstanceOf(WorkerHost);
  });

  it('应注册 error 与 failed 事件监听元数据', () => {
    expect(Reflect.getMetadata(ON_WORKER_EVENT_METADATA, ProbeProcessor.prototype.onWorkerError)).toEqual({
      eventName: 'error',
    });
    expect(Reflect.getMetadata(ON_WORKER_EVENT_METADATA, ProbeProcessor.prototype.onJobFailed)).toEqual({
      eventName: 'failed',
    });
  });

  it('onWorkerError 不应抛出（Redis OOM / 断连不得终止进程）', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const processor = new ProbeProcessor();

    expect(() =>
      processor.onWorkerError(new Error("OOM command not allowed when used memory > 'maxmemory'")),
    ).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('OOM command not allowed'));

    errorSpy.mockRestore();
  });

  it('onJobFailed 应记录重试进度', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const processor = new ProbeProcessor();
    const job = {
      name: 'tick',
      id: '42',
      queueName: 'demo',
      attemptsMade: 2,
      opts: { attempts: 3 },
    } as unknown as Job;

    processor.onJobFailed(job, new Error('boom'));

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('attempts=2/3'));
    warnSpy.mockRestore();
  });

  it('队列默认 job 选项应收敛内存占用（完成 1h/1k，失败 24h/5k）', () => {
    expect(QUEUE_DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({ age: 3600, count: 1000 });
    expect(QUEUE_DEFAULT_JOB_OPTIONS.removeOnFail).toEqual({ age: 86400, count: 5000 });
  });
});
