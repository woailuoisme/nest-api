import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPolicyCsv } from '../src/common/auth/casbin/rbac.model';

/**
 * 由 `ROLE_PERMISSIONS` 生成 / 校验 Casbin 策略文件。
 *
 * 用法：
 * - `just rbac-gen`        重新生成 `policy.csv`
 * - `just rbac-check`      仅校验（`--check`，供 `just check` 与 CI 使用，漂移即非零退出）
 */
const here = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/common/auth/casbin/policy.csv');
const checkOnly = process.argv.includes('--check');

const expected = buildPolicyCsv();

if (checkOnly) {
  const actual = readFileSync(target, 'utf8');
  if (actual !== expected) {
    console.error('✘ Casbin 策略与 ROLE_PERMISSIONS 不一致：请执行 `just rbac-gen` 后提交');
    process.exit(1);
  }
  console.log('✔ Casbin 策略与 ROLE_PERMISSIONS 一致');
} else {
  writeFileSync(target, expected, 'utf8');
  console.log(`rbac policy generated: ${target}`);
}
