import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ArtifactWriter, GENERATED_MARKER } from '@/commands/generator/artifact-writer';
import { TemplateRenderer } from '@/commands/generator/template-renderer';

const SCHEMA_INDEX = 'src/database/drizzle/schema/index.ts';
const ADMIN_MODULE = 'src/features/admin/admin.module.ts';
const FEATURES_INDEX = 'src/features/index.ts';

describe('ArtifactWriter', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'artifact-writer-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (relativePath: string, content: string): void => {
    const fullPath = join(root, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  };

  const read = (relativePath: string): string => readFileSync(join(root, relativePath), 'utf8');

  describe('updateSchemaExport()', () => {
    const base = "export * from './auth.schema';\n";

    it('注册应追加导出行，且重复注册幂等', () => {
      write(SCHEMA_INDEX, base);

      ArtifactWriter.updateSchemaExport(root, 'widget', 'register');
      ArtifactWriter.updateSchemaExport(root, 'widget', 'register');

      expect(read(SCHEMA_INDEX)).toBe(`${base}export * from './widget.schema';\n`);
    });

    it('反注册应删除导出行，且重复反注册幂等', () => {
      write(SCHEMA_INDEX, `${base}export * from './widget.schema';\n`);

      ArtifactWriter.updateSchemaExport(root, 'widget', 'unregister');
      ArtifactWriter.updateSchemaExport(root, 'widget', 'unregister');

      expect(read(SCHEMA_INDEX)).toBe(base);
    });
  });

  describe('updateAdminModuleExport()', () => {
    const adminModule = [
      "import { Module } from '@nestjs/common';",
      '',
      "import { AdminUsersModule } from './users/users.module';",
      '',
      '@Module({',
      '  imports: [AdminUsersModule],',
      '})',
      'export class AdminModule {}',
      '',
    ].join('\n');

    it('注册应同时插入 import 与 imports 条目', () => {
      write(ADMIN_MODULE, adminModule);

      ArtifactWriter.updateAdminModuleExport(root, 'widget', 'register');

      const content = read(ADMIN_MODULE);
      expect(content).toContain("import { WidgetModule } from './widget/widget.module';");
      expect(content).toContain('imports: [AdminUsersModule, WidgetModule]');
      // import 必须落在 import 区（最后一条 import 之后），不能插到装饰器之后
      expect(content.indexOf('import { WidgetModule }')).toBeLessThan(content.indexOf('@Module({'));
    });

    it('反注册应恢复原状，且重复反注册幂等', () => {
      write(ADMIN_MODULE, adminModule);
      ArtifactWriter.updateAdminModuleExport(root, 'widget', 'register');

      ArtifactWriter.updateAdminModuleExport(root, 'widget', 'unregister');
      ArtifactWriter.updateAdminModuleExport(root, 'widget', 'unregister');

      expect(read(ADMIN_MODULE)).toBe(adminModule);
    });

    it('AdminModule 文件缺失时应静默跳过', () => {
      expect(() => ArtifactWriter.updateAdminModuleExport(root, 'widget', 'register')).not.toThrow();
    });
  });

  describe('updateClientModuleExport()', () => {
    const featuresIndex = [
      "import { AuthModule } from '@/features/client/auth/auth.module';",
      "import { AdminModule } from '@/features/admin/admin.module';",
      '',
      'export const CLIENT_FEATURE_MODULES = [AuthModule] as const;',
      '',
      'export const FEATURE_MODULES = [AuthModule, AdminModule] as const;',
      '',
      "export * from '@/features/client/auth/auth.module';",
      '',
    ].join('\n');

    it('注册应插入 import、更新两个模块清单并把新模块排在 AdminModule 之前', () => {
      write(FEATURES_INDEX, featuresIndex);

      ArtifactWriter.updateClientModuleExport(root, 'widget', 'register');

      const content = read(FEATURES_INDEX);
      expect(content).toContain("import { WidgetModule } from '@/features/client/widget/widget.module';");
      expect(content).toContain('export const CLIENT_FEATURE_MODULES = [AuthModule, WidgetModule]');
      expect(content).toContain('export const FEATURE_MODULES = [AuthModule, WidgetModule, AdminModule]');
      expect(content).toContain("export * from '@/features/client/widget/widget.module';");
    });

    it('反注册应移除 import / export / 两个清单条目，且幂等', () => {
      write(FEATURES_INDEX, featuresIndex);
      ArtifactWriter.updateClientModuleExport(root, 'widget', 'register');

      ArtifactWriter.updateClientModuleExport(root, 'widget', 'unregister');
      ArtifactWriter.updateClientModuleExport(root, 'widget', 'unregister');

      expect(read(FEATURES_INDEX).trimEnd()).toBe(featuresIndex.trimEnd());
    });

    it('src/features/index.ts 缺失时应静默跳过', () => {
      expect(() => ArtifactWriter.updateClientModuleExport(root, 'widget', 'register')).not.toThrow();
    });
  });

  describe('detectConflicts()', () => {
    it('仅报手写文件冲突，@generated 文件视为可覆盖', () => {
      const ctx = TemplateRenderer.buildContext('widget', [], 'admin');
      write('src/features/admin/widget/widget.dto.ts', `${GENERATED_MARKER}\nexport const a = 1;`);
      write('src/features/admin/widget/widget.service.ts', 'export class HandWritten {}');

      const conflicts = ArtifactWriter.detectConflicts(root, ctx);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toContain('widget.service.ts');
    });

    it('目标文件不存在时不产生冲突', () => {
      const ctx = TemplateRenderer.buildContext('widget', [], 'admin');
      expect(ArtifactWriter.detectConflicts(root, ctx)).toEqual([]);
    });
  });

  describe('writeArtifacts()', () => {
    it('应递归创建目录、写入内容并返回相对路径', () => {
      const files = ArtifactWriter.writeArtifacts(root, [
        { outputPath: 'src/features/admin/widget/widget.dto.ts', content: 'dto' },
        { outputPath: 'tests/unit/features/admin/widget/widget.service.test.ts', content: 'test' },
      ]);

      expect(files).toEqual([
        'src/features/admin/widget/widget.dto.ts',
        'tests/unit/features/admin/widget/widget.service.test.ts',
      ]);
      expect(read('src/features/admin/widget/widget.dto.ts')).toBe('dto');
      expect(read('tests/unit/features/admin/widget/widget.service.test.ts')).toBe('test');
    });
  });

  describe('deleteModule()', () => {
    it('只删除带 @generated 标记的文件，并跳过手写文件', () => {
      write(ADMIN_MODULE, "import { Module } from '@nestjs/common';\n\nimports: []\n");
      write(SCHEMA_INDEX, "export * from './auth.schema';\n");
      write('src/features/admin/widget/widget.dto.ts', `${GENERATED_MARKER}\nexport const a = 1;`);
      write('src/features/admin/widget/widget.service.ts', 'export class HandWritten {}');

      const result = ArtifactWriter.deleteModule(root, 'widget', 'admin');

      expect(result.deleted.some((file) => file.includes('widget.dto.ts'))).toBe(true);
      expect(result.skipped.some((file) => file.includes('widget.service.ts'))).toBe(true);
      // 手写文件仍在磁盘上
      expect(read('src/features/admin/widget/widget.service.ts')).toBe('export class HandWritten {}');
    });
  });
});
