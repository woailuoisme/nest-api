import { Injectable } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';

import { startWorker } from '@/bootstrap/worker';

/**
 * 长驻进程命令 — 唯一前门是 CLI（容器 ENTRYPOINT 同样直接 exec 本 CLI），
 * 引导体集中在 `src/bootstrap/worker.ts`，消费队列与定时任务，不提供 HTTP。
 */
@Command({
  name: 'worker',
  description: 'Start the standalone queue worker (same bootstrap as the `worker` container verb)',
})
@Injectable()
export class WorkerCommand extends CommandRunner {
  async run(): Promise<void> {
    await startWorker();
  }
}
