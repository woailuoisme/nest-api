import { Permission } from '@/common/constants/permissions';
import { ROLE_PERMISSIONS } from '@/common/constants/role-permissions';
import { Role } from '@/common/constants/roles';

/**
 * Casbin RBAC 模型（内联，避免额外模型文件随包发布；策略仍走 `policy.csv`）。
 *
 * - `g` 保留角色继承位（当前无继承关系，domain 维度后续可在此扩展）
 * - matcher 为纯 RBAC：角色 × 资源 × 动作
 */
export const RBAC_MODEL = `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub) && r.obj == p.obj && r.act == p.act
`;

/** `user:create` → `{ obj: 'user', act: 'create' }`（Permission 枚举本身即 resource:action 语义） */
export function splitPermission(permission: Permission | string): { obj: string; act: string } {
  const [obj = '', act = ''] = permission.split(':');
  return { obj, act };
}

/**
 * 由 `ROLE_PERMISSIONS` 生成策略行（`[sub, obj, act]`）。
 *
 * 同时作为 `policy.csv` 生成与运行时一致性校验的单一事实源，避免两处各自拼装字符串。
 */
export function buildPolicyRows(): string[][] {
  const rows = new Map<string, string[]>();
  for (const role of Object.values(Role)) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      const { obj, act } = splitPermission(permission);
      rows.set(`${role}|${obj}|${act}`, [role, obj, act]);
    }
  }
  return [...rows.values()];
}

/**
 * 比对落盘策略行与期望策略行，返回是否存在差异。
 *
 * 逐行内容比对（而非仅比较条数）：空策略、旧策略与条数相同但条目不同的策略
 * 都会让 `@Permissions` 路由静默 403，必须在启动期全部拦住。
 */
export function hasPolicyDrift(actual: string[][], expected: string[][]): boolean {
  const toRowKey = (row: string[]) => row.join('|');
  const actualKeys = actual.map(toRowKey).sort();
  const expectedKeys = expected.map(toRowKey).sort();
  return actualKeys.length !== expectedKeys.length || actualKeys.some((row, index) => row !== expectedKeys[index]);
}

/**
 * 由 `ROLE_PERMISSIONS` 生成 `policy.csv` 内容。
 *
 * TS 常量是唯一事实源，CSV 为生成产物（`just rbac-gen`），
 * 单测与 `CasbinService` 启动校验共同防止两者漂移。
 */
export function buildPolicyCsv(): string {
  return `${buildPolicyRows()
    .map((row) => `p, ${row.join(', ')}`)
    .join('\n')}\n`;
}
