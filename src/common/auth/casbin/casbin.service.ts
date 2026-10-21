import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type Enforcer, FileAdapter, newEnforcer, newModelFromString } from 'casbin';

import type { Role } from '@/common/constants/roles';

import { RBAC_MODEL, buildPolicyRows, hasPolicyDrift, splitPermission } from './rbac.model';

/** 当前模块目录（ESM 安全：SWC 构建后与 dist 保持同构） */
const MODULE_DIR = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

/**
 * Casbin 授权引擎 — HTTP 边界的权限判定唯一入口。
 *
 * 策略来自同目录 `policy.csv`（由 `just rbac-gen` 从 `ROLE_PERMISSIONS` 生成）。
 * 加载失败或与 `ROLE_PERMISSIONS` 不一致时直接抛出中止启动（fail-fast）：
 * 缺失 / 过期策略会让所有 `@Permissions` 路由静默 403，宁可启动失败也不要带着失效的鉴权上线。
 */
@Injectable()
export class CasbinService implements OnModuleInit {
  private readonly logger = new Logger(CasbinService.name);
  #enforcer?: Enforcer;

  async onModuleInit(): Promise<void> {
    const policyPath = resolve(MODULE_DIR, 'policy.csv');
    try {
      this.#enforcer = await newEnforcer(newModelFromString(RBAC_MODEL), new FileAdapter(policyPath));
    } catch (error) {
      // 策略不可用时全部 @Permissions 路由都会 403：直接中止启动，避免以“静默全拒”状态上线
      this.logger.error(`Casbin 策略加载失败，已中止启动：${policyPath}`, error);
      throw error;
    }
    await this.#assertPolicyInSync(policyPath);
  }

  /**
   * 校验落盘策略与 `ROLE_PERMISSIONS` 逐行一致。
   *
   * 「加载成功」并不等于「策略有效」：空策略或忘记 `just rbac-gen` 的旧策略同样能加载，
   * 但会让全部 `@Permissions` 路由静默 403（无任何日志可追踪），因此在此做内容级比对。
   */
  async #assertPolicyInSync(policyPath: string): Promise<void> {
    if (!this.#enforcer) return;
    const actual = await this.#enforcer.getPolicy();
    const expected = buildPolicyRows();
    if (!hasPolicyDrift(actual, expected)) return;

    this.logger.error(
      `Casbin 策略与 ROLE_PERMISSIONS 不一致（${policyPath}：已加载 ${actual.length} 条 / 期望 ${expected.length} 条），已中止启动`,
    );
    throw new Error(`Casbin 策略 ${policyPath} 已过期，请执行 just rbac-gen 重新生成`);
  }

  /** 判定角色是否拥有指定权限（`user:read` → enforce(role, 'user', 'read')） */
  async can(role: Role | string, permission: string): Promise<boolean> {
    // onModuleInit 失败即抛错，此处缺失说明生命周期被绕过：显式失败而非静默拒绝
    if (!this.#enforcer) throw new Error('Casbin 未初始化：策略未加载');
    const { obj, act } = splitPermission(permission);
    return this.#enforcer.enforce(String(role), obj, act);
  }
}
