import { Injectable, Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';

import { CrudGeneratorService } from './crud-generator.service';
import type { CommandOptions } from './types';

/**
 * crud:generate CLI 命令 — 生成/覆盖/删除完整 CRUD 模块（恒定落入 /admin 后台边界）。
 *
 * 产物落 src/features/admin/<feature>/ 并自动注册进 AdminModule（受 AdminPrefixGuard 保护）。
 *
 * 使用示例:
 *   just cmd crud:generate -n product --from-schema auth --from-entity users
 *   just cmd crud:generate -n product --from-schema auth --from-entity users --force
 *   just cmd crud:generate -n product --delete
 */
@Command({
  name: 'crud:generate',
  description:
    '从已有 Drizzle schema 表定义自动生成完整 CRUD 模块（DTO / Service / Controller / Module / Schema / 单元测试）。\n' +
    '  --from-schema  schema 文件名（不含路径和扩展名），如 auth\n' +
    '  --from-entity  pgTable 导出的变量名，如 users\n' +
    '  --delete       安全删除已生成模块（仅删除含 @generated 标记的文件）\n' +
    '  --force        强制覆盖已存在文件',
})
@Injectable()
export class CrudGenerateCommand extends CommandRunner {
  private readonly logger = new Logger(CrudGenerateCommand.name);

  constructor(private readonly generator: CrudGeneratorService) {
    super();
  }

  async run(_passedParams: string[], options?: CommandOptions): Promise<void> {
    const name = options?.name;

    if (!name) {
      this.logger.error('缺少必选参数：--name');
      return;
    }

    // ── --delete 模式：安全回退 ─────────────────────
    if (options?.delete) {
      this.runDelete(name, options?.scope);
      return;
    }

    // ── 生成模式 ────────────────────────────────────
    const fromSchema = options?.fromSchema;
    const fromEntity = options?.fromEntity;
    const scope = options?.scope ?? 'admin';

    if (!fromSchema || !fromEntity) {
      this.logger.error('缺少必选参数：--from-schema 和 --from-entity（--delete 模式下不需要）');
      return;
    }

    const force = options?.force ?? false;

    const { errors, fieldDefs } = this.generator.parseSchemaFields(fromSchema, fromEntity);
    if (errors.length > 0 || !fieldDefs) {
      for (const err of errors) this.logger.error(err);
      return;
    }

    const result = this.generator.generate(name, fieldDefs, force, scope);
    if (!result) {
      this.logger.error('生成中止 — 存在文件冲突，使用 --force 强制覆盖');
      return;
    }

    this.printSummary(result.ctx.FeatureName, result.ctx.featureName, result.ctx.scope, result.ctx.routePrefix);
  }

  // ── 选项定义 ─────────────────────────────────────

  @Option({ flags: '-n, --name <name>', description: '模块名称（如 product），自动转换为复数表名', required: true })
  parseName(val: string): string {
    return val;
  }

  @Option({
    flags: '-s, --scope <scope>',
    description: '模块作用域：admin (默认后台管理面) | client (客户端业务面)',
    defaultValue: 'admin',
  })
  parseScope(val: string): 'admin' | 'client' {
    return val.toLowerCase() === 'client' ? 'client' : 'admin';
  }

  @Option({
    flags: '--from-schema <schemaFile>',
    description: 'Drizzle schema 文件名（不含路径和扩展名），如 auth、admin',
  })
  parseFromSchema(val: string): string {
    return val;
  }

  @Option({
    flags: '--from-entity <entityName>',
    description: 'pgTable 导出的变量名，如 users、adminUsers',
  })
  parseFromEntity(val: string): string {
    return val;
  }

  @Option({ flags: '--force', description: '强制覆盖已存在的文件', defaultValue: false })
  parseForce(): boolean {
    return true;
  }

  @Option({
    flags: '--delete',
    description: '安全删除已生成模块（仅删除含 @generated 标记的文件）',
    defaultValue: false,
  })
  parseDelete(): boolean {
    return true;
  }

  // ── private ──────────────────────────────────────

  /** 执行安全删除回退 */
  private runDelete(name: string, scope?: 'admin' | 'client'): void {
    this.logger.log(`准备删除模块: ${name} (scope=${scope ?? 'all'})`);
    const { deleted, skipped, errors } = this.generator.deleteModule(name, scope);

    if (deleted.length > 0) {
      this.logger.log('已删除:');
      for (const f of deleted) this.logger.log(`  ✓ ${f}`);
    }
    if (skipped.length > 0) {
      this.logger.warn('已跳过（非生成文件）:');
      for (const f of skipped) this.logger.warn(`  - ${f}`);
    }
    if (errors.length > 0) {
      for (const e of errors) this.logger.error(e);
    }

    if (deleted.length === 0 && skipped.length === 0 && errors.length === 0) {
      this.logger.log('没有找到可删除的文件');
    }
  }

  private printSummary(
    FeatureName: string,
    _featureName: string,
    scope: 'admin' | 'client',
    routePrefix: string,
  ): void {
    this.logger.log('----------------------------------------');
    this.logger.log(`crud:generate — ${FeatureName} 模块生成完毕！[scope=${scope}]`);
    if (scope === 'admin') {
      this.logger.log(
        `1. 模块已自动注册进 AdminModule（/${routePrefix} 路由受 AdminPrefixGuard 保护，仅 ADMIN 可访问）`,
      );
    } else {
      this.logger.log(`1. 模块已自动注册进 src/features/index.ts（/${routePrefix} 路由挂载于客户端特性清单）`);
    }
    this.logger.log('2. 请运行 just db-gen && just db-migrate 应用新表迁移');
    this.logger.log(
      `3. 请在 src/common/constants/permissions.ts 中添加权限: ${FeatureName}Create / ${FeatureName}Read / ${FeatureName}Update / ${FeatureName}Delete，并取消 controller 中对应 @Permissions 注释`,
    );
    this.logger.log('----------------------------------------');
  }
}
