import { MODULE_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { isProcessCommand, PROCESS_COMMAND_NAMES, ProcessCommandsModule } from '@/commands/process-commands.module';
import { ServeCommand } from '@/commands/serve.command';
import { WorkerCommand } from '@/commands/worker.command';

// 引导体会构建完整应用图并常驻，测试中恒以桩替代
vi.mock('@/bootstrap/server', () => ({ startServer: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/bootstrap/worker', () => ({ startWorker: vi.fn().mockResolvedValue(undefined) }));

describe('CLI 长驻进程命令 (serve / worker)', () => {
  it('动词清单覆盖命令名与别名，其余命令不误判', () => {
    expect(PROCESS_COMMAND_NAMES).toEqual(['serve', 'server', 'worker']);
    expect(isProcessCommand('serve')).toBe(true);
    expect(isProcessCommand('server')).toBe(true);
    expect(isProcessCommand('worker')).toBe(true);
    expect(isProcessCommand('route:list')).toBe(false);
    expect(isProcessCommand(undefined)).toBe(false);
  });

  it('模块只声明两个命令且仅依赖 DiscoveryModule（不得引入基础设施，否则与引导体重复实例化）', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, ProcessCommandsModule) as unknown[];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ProcessCommandsModule) as unknown[];

    expect(imports).toEqual([DiscoveryModule]);
    expect(providers).toEqual([ServeCommand, WorkerCommand]);
  });

  it('serve 委托 startServer，worker 委托 startWorker', async () => {
    const { startServer } = await import('@/bootstrap/server');
    const { startWorker } = await import('@/bootstrap/worker');

    await new ServeCommand().run();
    expect(startServer).toHaveBeenCalledOnce();

    await new WorkerCommand().run();
    expect(startWorker).toHaveBeenCalledOnce();
  });
});
