import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { ServeCommand } from './serve.command';
import { WorkerCommand } from './worker.command';

/**
 * 长驻进程命令的唯一动词清单（含别名）。`cli.ts` 据此决定根模块：
 * 命中时用本模块，避免为启动服务器而额外构建 CliModule 的完整依赖图
 * （否则同一进程会实例化两套 DB / Redis / BullMQ）。
 *
 * 新增长驻命令时必须同步此清单，否则会被当作一次性命令走 CliModule。
 */
export const PROCESS_COMMAND_NAMES: readonly string[] = ['serve', 'server', 'worker'];

/** argv 首个位置参数是否为长驻进程动词 */
export function isProcessCommand(verb: string | undefined): boolean {
  return verb !== undefined && PROCESS_COMMAND_NAMES.includes(verb);
}

/**
 * 长驻进程命令的最小根模块 — 只声明两个命令，不引入任何基础设施模块。
 * 同时被 CliModule 引入，使 `cli --help` 能列出这两个命令。
 */
@Module({
  imports: [DiscoveryModule],
  providers: [ServeCommand, WorkerCommand],
  exports: [ServeCommand, WorkerCommand],
})
export class ProcessCommandsModule {}
