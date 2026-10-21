import { Injectable } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';

import { startServer } from '@/bootstrap/server';

/**
 * 长驻进程命令 — 全项目唯一启动前门（容器 ENTRYPOINT 同样直接 exec 本 CLI），
 * 引导体集中在 `src/bootstrap/server.ts`，日志与优雅停机语义与容器完全一致。
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
