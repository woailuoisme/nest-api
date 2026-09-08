import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { Logger } from '@nestjs/common';
import { compact } from 'es-toolkit';
import { toCamelCase, toPascalCase } from './string.utils';
import { type RenderedArtifact, TEMPLATE_FILES, TemplateRenderer } from './template-renderer';
import type { ModuleScope, TemplateContext } from './types';

/** 用于区分"生成模块"与"手写模块"的文件头标记 */
export const GENERATED_MARKER = '// @generated crud:generate';

/** 删除结果 — 成功删除 / 跳过 / 失败明细 */
export interface DeleteResult {
  deleted: string[];
  skipped: string[];
  errors: string[];
}

const logger = new Logger('ArtifactWriter');

/** 读取文件第一行 */
function readFirstLine(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8').split('\n')[0]?.trim() || null;
  } catch {
    return null;
  }
}

/** 删除生成模块后清理空目录 */
function cleanupEmptyDirs(projectRoot: string, ctx: TemplateContext): void {
  const dirsToCheck = [
    join(projectRoot, `tests/unit/${ctx.featureModulePath}`),
    join(projectRoot, `src/${ctx.featureModulePath}`),
  ];

  for (const dir of dirsToCheck) {
    try {
      if (existsSync(dir) && readdirSync(dir).length === 0) {
        rmdirSync(dir);
        logger.log(`  ✓ 已清理空目录: ${relative(projectRoot, dir)}`);
      }
    } catch {
      // 忽略
    }
  }
}

/**
 * 文件安全写入与清理管理器 (Artifact Safe Writer)
 */
export const ArtifactWriter = {
  /**
   * 检测是否有已存在的生成文件（不含 @generated 标记的视为手写文件，不允许覆盖）。
   */
  detectConflicts(projectRoot: string, ctx: TemplateContext): string[] {
    const conflicts: string[] = [];

    for (const entry of TEMPLATE_FILES) {
      const outputPath = join(projectRoot, entry.output(ctx));
      if (existsSync(outputPath)) {
        const firstLine = readFirstLine(outputPath);
        if (firstLine?.startsWith(GENERATED_MARKER)) {
          continue;
        }
        conflicts.push(`文件已存在且非 crud:generate 生成，拒绝覆盖：${entry.output(ctx)}`);
      }
    }

    return conflicts;
  },

  /**
   * 将渲染好的产物安全写入磁盘
   */
  writeArtifacts(projectRoot: string, artifacts: RenderedArtifact[]): string[] {
    const writtenFiles: string[] = [];

    for (const artifact of artifacts) {
      const fullPath = join(projectRoot, artifact.outputPath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, artifact.content, 'utf8');
      writtenFiles.push(artifact.outputPath);
      logger.log(`  ✓ 已生成 ${artifact.outputPath}`);
    }

    return writtenFiles;
  },

  /**
   * 安全删除已生成的 CRUD 模块。
   * 仅删除首行包含 @generated 标记的文件，防止误删手写代码。
   */
  deleteModule(projectRoot: string, name: string, scope?: ModuleScope): DeleteResult {
    const featureName = toCamelCase(name);
    const scopesToCheck: ModuleScope[] = scope ? [scope] : ['admin', 'client'];
    const result: DeleteResult = {
      deleted: [],
      skipped: [],
      errors: [],
    };

    // 1. 遍历匹配 scope 的生成文件并删除
    for (const s of scopesToCheck) {
      const ctx = TemplateRenderer.buildContext(featureName, [], s);
      for (const entry of TEMPLATE_FILES) {
        const outputPath = join(projectRoot, entry.output(ctx));
        if (!existsSync(outputPath)) {
          continue;
        }

        const firstLine = readFirstLine(outputPath);
        if (!firstLine?.startsWith(GENERATED_MARKER)) {
          result.skipped.push(`${entry.output(ctx)} (非生成文件，跳过)`);
          continue;
        }

        try {
          unlinkSync(outputPath);
          result.deleted.push(entry.output(ctx));
        } catch {
          result.errors.push(`删除失败: ${entry.output(ctx)}`);
        }
      }

      // 清理空目录
      cleanupEmptyDirs(projectRoot, ctx);
    }

    // 2. 从 schema/index.ts 移除导出行（仅当对应 schema 文件已删除或不存在时）
    const schemaFilePath = join(projectRoot, 'src', 'database', 'drizzle', 'schema', `${featureName}.schema.ts`);
    if (!existsSync(schemaFilePath)) {
      try {
        ArtifactWriter.updateSchemaExport(projectRoot, featureName, 'unregister');
        result.deleted.push(`src/database/drizzle/schema/index.ts (已移除 ${featureName} 导出)`);
      } catch (err) {
        result.errors.push(`移除 schema 导出失败: ${(err as Error).message}`);
      }
    }

    // 3. 仅当删除 admin scope 时，从 AdminModule 移除模块注册（幂等）
    if (!scope || scope === 'admin') {
      try {
        ArtifactWriter.updateAdminModuleExport(projectRoot, featureName, 'unregister');
      } catch (err) {
        result.errors.push(`移除 AdminModule 注册失败: ${(err as Error).message}`);
      }
    }

    // 4. 仅当删除 client scope 时，从 src/api/index.ts 移除客户端模块注册（幂等）
    if (!scope || scope === 'client') {
      try {
        ArtifactWriter.updateClientModuleExport(projectRoot, featureName, 'unregister');
      } catch (err) {
        result.errors.push(`移除 Client API 注册失败: ${(err as Error).message}`);
      }
    }

    return result;
  },

  /**
   * 追加/移除指定 feature 的 schema 导出行（幂等）。
   * @param action 'register' 追加导出 | 'unregister' 移除导出
   */
  updateSchemaExport(projectRoot: string, featureName: string, action: 'register' | 'unregister'): void {
    const indexPath = join(projectRoot, 'src', 'database', 'drizzle', 'schema', 'index.ts');
    const content = readFileSync(indexPath, 'utf8');
    const exportLine = `export * from './${featureName}.schema';`;
    const present = content.includes(exportLine);

    if (action === 'register' ? present : !present) return;

    const next =
      action === 'register'
        ? `${content.trimEnd()}\n${exportLine}\n`
        : content
            .split('\n')
            .filter((line) => line.trim() !== exportLine)
            .join('\n');

    writeFileSync(indexPath, next, 'utf8');
    logger.log(`  ✓ 已${action === 'register' ? '注册' : '移除'} schema 导出: ${exportLine}`);
  },

  /**
   * 追加/移除指定 feature 模块在 AdminModule 中的注册（幂等）。
   * import 行与 imports 数组项同步维护，生成/删除生命周期完全对称。
   */
  updateAdminModuleExport(projectRoot: string, featureName: string, action: 'register' | 'unregister'): void {
    const adminModulePath = join(projectRoot, 'src', 'features', 'admin', 'admin.module.ts');
    if (!existsSync(adminModulePath)) return;

    const content = readFileSync(adminModulePath, 'utf8');
    const moduleName = `${toPascalCase(featureName)}Module`;
    const importLine = `import { ${moduleName} } from './${featureName}/${featureName}.module';`;
    const present = content.includes(importLine);

    if (action === 'register' ? present : !present) return;

    let next: string;
    if (action === 'register') {
      const lines = content.split('\n');
      let lastImportIdx = -1;
      lines.forEach((line, idx) => {
        if (line.startsWith('import ')) lastImportIdx = idx;
      });
      lines.splice(lastImportIdx + 1, 0, importLine);
      next = lines.join('\n').replace(/imports: \[([^\]]*)\]/, (_m, list: string) => {
        const items = compact(list.split(',').map((s) => s.trim()));
        items.push(moduleName);
        return `imports: [${items.join(', ')}]`;
      });
    } else {
      next = content
        .split('\n')
        .filter((line) => line.trim() !== importLine)
        .join('\n')
        .replace(/imports: \[([^\]]*)\]/, (_m, list: string) => {
          const items = list
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s && s !== moduleName);
          return `imports: [${items.join(', ')}]`;
        });
    }

    writeFileSync(adminModulePath, next, 'utf8');
    logger.log(`  ✓ 已${action === 'register' ? '注册' : '移除'} AdminModule 模块: ${moduleName}`);
  },

  /**
   * 追加/移除指定客户端 feature 模块在 src/features/index.ts 中的注册与导出（幂等）。
   */
  updateClientModuleExport(projectRoot: string, featureName: string, action: 'register' | 'unregister'): void {
    const apiIndexPath = join(projectRoot, 'src', 'features', 'index.ts');
    if (!existsSync(apiIndexPath)) return;

    const content = readFileSync(apiIndexPath, 'utf8');
    const moduleName = `${toPascalCase(featureName)}Module`;
    const importLine = `import { ${moduleName} } from '@/features/client/${featureName}/${featureName}.module';`;
    const exportLine = `export * from '@/features/client/${featureName}/${featureName}.module';`;
    const present = content.includes(importLine);

    if (action === 'register' ? present : !present) return;

    let next: string;
    if (action === 'register') {
      const lines = content.split('\n');
      let lastImportIdx = -1;
      lines.forEach((line, idx) => {
        if (line.startsWith('import ')) lastImportIdx = idx;
      });
      lines.splice(lastImportIdx + 1, 0, importLine);

      next = lines
        .join('\n')
        .replace(
          /export const (CLIENT_FEATURE_MODULES|CLIENT_API_MODULES) = \[([^\]]*)\]/,
          (_m, constName: string, list: string) => {
            const items = compact(list.split(',').map((s) => s.trim()));
            items.push(moduleName);
            return `export const ${constName} = [${items.join(', ')}]`;
          },
        )
        .replace(/export const (FEATURE_MODULES|API_MODULES) = \[([^\]]*)\]/, (_m, constName: string, list: string) => {
          const items = compact(list.split(',').map((s) => s.trim()));
          // 插入在 AdminModule 之前
          const adminIdx = items.indexOf('AdminModule');
          if (adminIdx !== -1) {
            items.splice(adminIdx, 0, moduleName);
          } else {
            items.push(moduleName);
          }
          return `export const ${constName} = [${items.join(', ')}]`;
        });
      next = `${next.trimEnd()}\n${exportLine}\n`;
    } else {
      next = content
        .split('\n')
        .filter((line) => line.trim() !== importLine && line.trim() !== exportLine)
        .join('\n')
        .replace(
          /export const (CLIENT_FEATURE_MODULES|CLIENT_API_MODULES) = \[([^\]]*)\]/,
          (_m, constName: string, list: string) => {
            const items = list
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s && s !== moduleName);
            return `export const ${constName} = [${items.join(', ')}]`;
          },
        )
        .replace(/export const (FEATURE_MODULES|API_MODULES) = \[([^\]]*)\]/, (_m, constName: string, list: string) => {
          const items = list
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s && s !== moduleName);
          return `export const ${constName} = [${items.join(', ')}]`;
        });
    }

    writeFileSync(apiIndexPath, next, 'utf8');
    logger.log(`  ✓ 已${action === 'register' ? '注册' : '移除'} Client API 模块: ${moduleName}`);
  },

  /**
   * 统一根据 scope 注册/注销模块
   */
  updateModuleRegistration(
    projectRoot: string,
    featureName: string,
    scope: ModuleScope,
    action: 'register' | 'unregister',
  ): void {
    if (scope === 'admin') {
      ArtifactWriter.updateAdminModuleExport(projectRoot, featureName, action);
    } else {
      ArtifactWriter.updateClientModuleExport(projectRoot, featureName, action);
    }
  },
};
