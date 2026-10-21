/**
 * entrypoint.sh 分发契约 — 守住「容器 verb → 启动 argv」的映射。
 *
 * 镜像 ENTRYPOINT 是 `tini -- entrypoint.sh`，所以 verb 拼错或 dist 入口改名
 * 都会在生产期才暴露。此处用 PATH 前置的 bun 桩脚本断言映射本身，
 * 不依赖 dist 产物、数据库与真实进程启动。
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ENTRYPOINT = fileURLToPath(new URL('../../../entrypoint.sh', import.meta.url));

let stubDir: string;

/** 以 PATH 前置的 bun 桩执行 entrypoint.sh，返回桩收到的 argv（空格拼接） */
function dispatch(args: string[]): string {
  return execFileSync('sh', [ENTRYPOINT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ''}` },
  }).trim();
}

describe('entrypoint.sh 分发契约', () => {
  beforeAll(() => {
    stubDir = mkdtempSync(join(tmpdir(), 'entrypoint-dispatch-'));
    const stub = join(stubDir, 'bun');
    // 只回显 argv，避免真实执行 dist 产物
    writeFileSync(stub, '#!/bin/sh\necho "$@"\n');
    chmodSync(stub, 0o755);
  });

  afterAll(() => {
    rmSync(stubDir, { recursive: true, force: true });
  });

  it('api → bun run dist/main.js', () => {
    expect(dispatch(['api'])).toBe('run dist/main.js');
  });

  it('无参数（CMD 默认）→ 等同 api', () => {
    expect(dispatch([])).toBe('run dist/main.js');
  });

  it('worker → bun run dist/workers/worker.main.js', () => {
    expect(dispatch(['worker'])).toBe('run dist/workers/worker.main.js');
  });

  it('cli 透传子命令 → bun run dist/cli.js route:list', () => {
    expect(dispatch(['cli', 'route:list'])).toBe('run dist/cli.js route:list');
  });

  it('前导选项自动补全 bun → -v 变为 bun -v', () => {
    expect(dispatch(['-v'])).toBe('-v');
  });

  it('未知命令原样透传（诊断入口 sh / node 可用）', () => {
    expect(dispatch(['echo', 'passthrough'])).toBe('passthrough');
  });
});
