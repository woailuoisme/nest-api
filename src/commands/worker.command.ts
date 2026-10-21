import { Injectable } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';

import { startWorker } from '@/bootstrap/worker';

/**
 * 长驻进程命令 — 与容器 verb `worker` 共用同一引导体（`startWorker`），
 * 消费队列与定时任务，不提供 HTTP。
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
