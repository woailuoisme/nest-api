import { Injectable } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';

import { startServer } from '@/bootstrap/server';

/**
 * 长驻进程命令 — 与容器 verb `api` 共用同一引导体（`startServer`），
 * 行为、日志与优雅停机语义完全一致，只是前门从 entrypoint.sh 换成 CLI。
 */
@Command({
  name: 'serve',
  aliases: ['server'],
  description: 'Start the HTTP API server (same bootstrap as the `api` container verb)',
})
@Injectable()
export class ServeCommand extends CommandRunner {
  async run(): Promise<void> {
    await startServer();
  }
}
