import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

/**
 * 队列消费者基类 — 统一兜底 BullMQ Worker 的运行期事件。
 *
 * BullMQ 的 `Worker` 是 EventEmitter：`error` 事件（Redis OOM / 连接中断 / Lua 脚本失败）
 * 若没有任何监听器，Node 会把它抛成未捕获异常并**直接终止进程**（表现为 worker 退出 code 1）。
 * 基类统一接管后：记录错误并继续消费，Redis 恢复后由 BullMQ 自动重连并重新拉取任务。
 *
 * 注意：Redis 侧仍应配置 `maxmemory-policy noeviction`（BullMQ 强依赖，禁用逐出），
 * 容量不足时通过扩容或清理历史 job 解决，不能靠 eviction 策略掩盖。
 */
export abstract class QueueProcessorHost extends WorkerHost {
  readonly #logger = new Logger(this.constructor.name);

  /** Worker 级错误：不抛出，保证进程存活（否则 Redis 抖动会导致 worker 反复崩溃重启） */
  @OnWorkerEvent('error')
  onWorkerError(error: Error): void {
    this.#logger.error(`队列运行错误（进程保持存活，等待 Redis 恢复）: ${error.message}`);
  }

  /** 任务级失败：记录尝试次数，便于排查重试耗尽与毒任务 */
  @OnWorkerEvent('failed')
  onJobFailed(job: Job | undefined, error: Error): void {
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 1;
    this.#logger.warn(
      `任务执行失败: queue=${job?.queueName ?? 'unknown'} name=${job?.name ?? 'unknown'} id=${job?.id ?? '-'} attempts=${attempts}/${maxAttempts} error=${error.message}`,
    );
  }
}
