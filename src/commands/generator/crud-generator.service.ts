import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Injectable, Logger } from '@nestjs/common';

import { ArtifactWriter, type DeleteResult } from './artifact-writer';
import { SchemaInspector } from './schema-inspector';
import { TemplateRenderer } from './template-renderer';
import type { FieldDef, ModuleScope, TemplateContext } from './types';

const currentDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

/**
 * CRUD 模块生成器门面服务 (CrudGeneratorService)
 *
 * 专注于流程编排与生命周期调度，底层职责彻底解耦：
 * 1. `SchemaInspector`: Drizzle Schema 反解与结构探测；
 * 2. `TemplateRenderer`: 纯内存 Handlebars 模板变换（零 I/O，极速单测）；
 * 3. `ArtifactWriter`: 安全写盘、冲突检测、模式注册与回滚。
 */
@Injectable()
export class CrudGeneratorService {
  private readonly logger = new Logger(CrudGeneratorService.name);

  /**
   * 生成完整的 CRUD 模块（支持 admin 和 client 两种作用域）。
   */
  generate(
    name: string,
    fieldDefs: FieldDef[],
    force = false,
    scope: ModuleScope = 'admin',
  ): { ctx: TemplateContext; files: string[] } | null {
    const ctx = TemplateRenderer.buildContext(name, fieldDefs, scope);
    const projectRoot = process.cwd();
    const tmplDir = resolve(currentDir, 'templates');

    // 1. 冲突检测（--force 模式下跳过）
    if (!force) {
      const conflicts = ArtifactWriter.detectConflicts(projectRoot, ctx);
      if (conflicts.length > 0) {
        for (const c of conflicts) this.logger.error(c);
        return null;
      }
    }

    // 2. 纯内存模板渲染
    const artifacts = TemplateRenderer.renderAll(tmplDir, ctx);

    // 3. 安全写盘
    const writtenFiles = ArtifactWriter.writeArtifacts(projectRoot, artifacts);

    // 4. 注册 Drizzle Schema 导出
    ArtifactWriter.updateSchemaExport(projectRoot, ctx.featureName, 'register');

    // 5. 注册进对应端入口（AdminModule 或 src/features/index.ts）
    ArtifactWriter.updateModuleRegistration(projectRoot, ctx.featureName, ctx.scope, 'register');

    return { ctx, files: writtenFiles };
  }

  /**
   * 检测冲突
   */
  detectConflicts(projectRoot: string, ctx: TemplateContext): string[] {
    return ArtifactWriter.detectConflicts(projectRoot, ctx);
  }

  /**
   * 安全删除已生成的 CRUD 模块。
   */
  deleteModule(name: string, scope?: ModuleScope): DeleteResult {
    return ArtifactWriter.deleteModule(process.cwd(), name, scope);
  }

  /**
   * 从 Drizzle schema 源文件解析字段定义。
   */
  parseSchemaFields(schemaFileName: string, tableName: string): { errors: string[]; fieldDefs: FieldDef[] | null } {
    const schemaPath = join(process.cwd(), 'src', 'database', 'drizzle', 'schema', `${schemaFileName}.schema.ts`);
    const result = SchemaInspector.parseSchemaFields(schemaPath, tableName);

    if (result.fieldDefs && result.errors.length === 0) {
      this.logger.log(`✓ 从 ${schemaFileName}.schema.ts / ${tableName} 解析到 ${result.fieldDefs.length} 个字段`);
    }

    return result;
  }
}
