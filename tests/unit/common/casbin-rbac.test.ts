import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, beforeAll } from 'vitest';

import { CasbinService } from '@/common/auth/casbin/casbin.service';
import { buildPolicyCsv, buildPolicyRows, hasPolicyDrift } from '@/common/auth/casbin/rbac.model';
import { adminRbacPlugin } from '@/common/auth/rbac.config';
import { Permission } from '@/common/constants/permissions';
import { ROLE_PERMISSIONS } from '@/common/constants/role-permissions';
import { Role } from '@/common/constants/roles';

/** 以仓库根为基准（vitest 从项目根启动），避免测试文件移动导致路径断裂 */
const POLICY_PATH = resolve(process.cwd(), 'src/common/auth/casbin/policy.csv');

describe('Casbin RBAC', () => {
  let casbin: CasbinService;

  beforeAll(async () => {
    casbin = new CasbinService();
    await casbin.onModuleInit();
  });

  it('policy.csv 与 ROLE_PERMISSIONS 保持同步（漂移即失败）', () => {
    expect(readFileSync(POLICY_PATH, 'utf8')).toBe(buildPolicyCsv());
  });

  it('启动期漂移检测：缺失、多余与同条数改写都必须被判定为漂移', () => {
    const expected = buildPolicyRows();

    expect(hasPolicyDrift(expected, buildPolicyRows())).toBe(false);
    // 缺失一行（模拟忘记重跑 rbac-gen 的旧策略）
    expect(hasPolicyDrift(expected.slice(1), buildPolicyRows())).toBe(true);
    // 多一行（模拟已从 ROLE_PERMISSIONS 移除但 CSV 未更新）
    expect(hasPolicyDrift([...expected, ['GHOST', 'user', 'read']], buildPolicyRows())).toBe(true);
    // 条数相同但内容被改写（仅比对条数会漏判）
    expect(hasPolicyDrift([...expected.slice(1), ['ADMIN', 'user', 'not-a-permission']], buildPolicyRows())).toBe(true);
    // 空策略（文件存在但无任何 p 行）会让全部 @Permissions 路由静默 403
    expect(hasPolicyDrift([], buildPolicyRows())).toBe(true);
  });

  it('ADMIN 拥有全量权限', async () => {
    for (const permission of Object.values(Permission)) {
      await expect(casbin.can(Role.ADMIN, permission)).resolves.toBe(true);
    }
  });

  it('OPERATOR 仅限授权子集', async () => {
    await expect(casbin.can(Role.OPERATOR, Permission.UserRead)).resolves.toBe(true);
    await expect(casbin.can(Role.OPERATOR, Permission.UserUpdate)).resolves.toBe(true);
    await expect(casbin.can(Role.OPERATOR, Permission.ReportRead)).resolves.toBe(true);
    await expect(casbin.can(Role.OPERATOR, Permission.UserDelete)).resolves.toBe(false);
    await expect(casbin.can(Role.OPERATOR, Permission.UserCreate)).resolves.toBe(false);
  });

  it('USER 仅有只读权限', async () => {
    await expect(casbin.can(Role.USER, Permission.UserRead)).resolves.toBe(true);
    await expect(casbin.can(Role.USER, Permission.UserUpdate)).resolves.toBe(false);
  });

  it('未知角色一律拒绝', async () => {
    await expect(casbin.can('GHOST', Permission.UserRead)).resolves.toBe(false);
  });

  it('better-auth 插件管理员角色与“拥有全量权限的角色”一致（W4 防漂移）', () => {
    const fullPermissionRoles = Object.values(Role).filter(
      (role) => ROLE_PERMISSIONS[role].length === Object.values(Permission).length,
    );
    const adminRoles = (adminRbacPlugin as unknown as { options?: { adminRoles?: string[] } }).options?.adminRoles;

    // 反射插件内部结构：缺失时给出明确诊断，而非笼统的 undefined 比较失败
    expect(adminRoles, 'better-auth admin 插件内部结构变化：options.adminRoles 缺失').toBeDefined();
    expect(new Set(adminRoles)).toEqual(new Set(fullPermissionRoles));
  });

  it('每个角色在策略中都有显式条目', () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_PERMISSIONS[role]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
