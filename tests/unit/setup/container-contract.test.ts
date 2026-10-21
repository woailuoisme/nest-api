/**
 * 容器启动契约 — 镜像只 exec `dist/cli.js`，进程类型由 CMD / 编排器 args 决定。
 *
 * 历史 `entrypoint.sh` shell 分发器已删除：它把「首参是动词」的隐式约定塞进镜像，
 * 且与仓库里三处启动命名各说一套。此处锁住新契约，防止分发脚本或旧 verb 回流。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT_URL = new URL('../../../', import.meta.url);

function readRepoFile(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, ROOT_URL)), 'utf8');
}

describe('容器启动契约（无 shell 分发）', () => {
  it('Dockerfile 以 dist/cli.js 为唯一 ENTRYPOINT，默认 CMD 为 serve', () => {
    const dockerfile = readRepoFile('Dockerfile');

    expect(dockerfile).toContain('ENTRYPOINT ["/sbin/tini", "--", "bun", "run", "dist/cli.js"]');
    expect(dockerfile).toContain('CMD ["serve"]');
    expect(dockerfile).not.toMatch(/entrypoint\.sh/i);
  });

  it('compose 的 worker 服务仅通过 args 覆写进程类型', () => {
    const compose = readRepoFile('docker-compose.yml');

    expect(compose).toMatch(/command:\s*\['worker'\]/);
    expect(compose).not.toMatch(/entrypoint\.sh/i);
  });
});
