import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { ArtifactWriter } from '@/commands/generator/artifact-writer';
import { CrudGeneratorService } from '@/commands/generator/crud-generator.service';
import { TemplateRenderer } from '@/commands/generator/template-renderer';
import { PATHS } from '@/common/constants/app.constants';

describe('CrudGeneratorService', () => {
  let service: CrudGeneratorService;

  beforeEach(() => {
    service = new CrudGeneratorService();
  });

  describe('TemplateRenderer — 纯内存模板转换', () => {
    it('应正确构建 TemplateContext 并渲染无 I/O 的产物', () => {
      const ctx = TemplateRenderer.buildContext('sample_product', [
        { name: 'title', type: 'string', required: true, description: '产品标题' },
        { name: 'price', type: 'float', required: true, description: '价格' },
      ]);

      expect(ctx.featureName).toBe('sampleProduct');
      expect(ctx.FeatureName).toBe('SampleProduct');
      expect(ctx.tableName).toBe('sample_products');
      expect(ctx.featureModulePath).toBe('features/admin/sampleProduct');
      expect(ctx.fields).toHaveLength(2);
      expect(ctx.fields[0].apiProperty).toContain('产品标题');

      const tmplDir = resolve(process.cwd(), 'src/commands/generator/templates');
      const artifacts = TemplateRenderer.renderAll(tmplDir, ctx);

      expect(artifacts.length).toBeGreaterThan(0);
      const serviceArtifact = artifacts.find((a) => a.outputPath.endsWith('.service.ts'));
      expect(serviceArtifact).toBeDefined();
      expect(serviceArtifact!.outputPath).toBe('src/features/admin/sampleProduct/sampleProduct.service.ts');
      expect(serviceArtifact!.content).toContain('class SampleProductService');
      expect(serviceArtifact!.content).toContain('@InjectDb() private readonly db: DrizzleDB');

      const controllerArtifact = artifacts.find((a) => a.outputPath.endsWith('.controller.ts'));
      expect(controllerArtifact!.content).toContain("@Controller('admin/sample_products')");
      expect(controllerArtifact!.content).toContain("@ApiTags('SampleProduct')");

      const testArtifact = artifacts.find((a) => a.outputPath.endsWith('.service.test.ts'));
      expect(testArtifact!.outputPath).toBe('tests/unit/features/admin/sampleProduct/sampleProduct.service.test.ts');
      expect(testArtifact!.content).toContain("from '@/features/admin/sampleProduct/sampleProduct.service'");
    });

    it('产物应使用原生 Standard Schema 契约（@Body({ schema }) + @SerializeOptions），且不再产出 createZodDto', () => {
      const ctx = TemplateRenderer.buildContext('sample_product', [
        { name: 'title', type: 'string', required: true, description: '产品标题' },
        { name: 'price', type: 'float', required: true, description: '价格' },
      ]);
      const tmplDir = resolve(process.cwd(), 'src/commands/generator/templates');
      const artifacts = TemplateRenderer.renderAll(tmplDir, ctx);

      const dtoArtifact = artifacts.find((a) => a.outputPath.endsWith('.dto.ts'));
      expect(dtoArtifact).toBeDefined();
      // 输出契约：资源 schema 同时驱动运行时序列化与 OpenAPI，列表信封复用分页工厂
      expect(dtoArtifact!.content).toContain('export const SampleProductResourceSchema = z.object({');
      expect(dtoArtifact!.content).toContain('paginatedEnvelopeSchema(SampleProductResourceSchema)');

      const controllerArtifact = artifacts.find((a) => a.outputPath.endsWith('.controller.ts'));
      expect(controllerArtifact!.content).toContain('@Body({ schema: CreateSampleProductSchema })');
      expect(controllerArtifact!.content).toContain('@Query({ schema: FindSampleProductsSchema })');
      expect(controllerArtifact!.content).toContain('@SerializeOptions({ schema: SampleProductResourceSchema })');
      expect(controllerArtifact!.content).toContain('@SerializeOptions({ schema: SampleProductPageResourceSchema })');

      // 迁移到框架原生通道后不应再有任何 nestjs-zod 残留
      for (const artifact of artifacts) {
        expect(artifact.content).not.toContain('createZodDto');
      }
    });
  });

  describe('parseSchemaFields()', () => {
    it('应能正确解析 better-auth.schema.ts 中的 user 表字段', () => {
      const result = service.parseSchemaFields('better-auth', 'user');

      expect(result.errors).toHaveLength(0);
      expect(result.fieldDefs).not.toBeNull();
      expect(result.fieldDefs!.length).toBeGreaterThan(0);

      const fieldNames = result.fieldDefs!.map((f) => f.name);
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('email');
      expect(fieldNames).toContain('role');
    });

    it('当 schema 文件不存在时应返回错误信息', () => {
      const result = service.parseSchemaFields('non_existent_schema', 'dummy');

      expect(result.fieldDefs).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('不存在');
    });

    it('当 schema 存在但表名不存在时应返回错误', () => {
      const result = service.parseSchemaFields('better-auth', 'non_existent_table');

      expect(result.fieldDefs).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('未找到表定义');
    });
  });

  describe('detectConflicts()', () => {
    it('当目标文件不存在时应返回空冲突列表', () => {
      const ctx = TemplateRenderer.buildContext('sample_product', [{ name: 'title', type: 'string', required: true }]);
      const tempDir = join(process.cwd(), PATHS.STORAGE_TMP, 'non-existent-test-dir');

      const conflicts = service.detectConflicts(tempDir, ctx);
      expect(conflicts).toHaveLength(0);
    });

    it('当目标文件存在且包含 @generated 标记时允许覆盖（无冲突）', () => {
      const ctx = TemplateRenderer.buildContext('sample_product', [{ name: 'title', type: 'string', required: true }]);
      const tempDir = join(process.cwd(), PATHS.STORAGE_TMP, 'gen-test-root');
      const targetFile = join(tempDir, 'src', 'features', 'admin', 'sampleProduct', 'sampleProduct.service.ts');

      mkdirSync(dirname(targetFile), { recursive: true });
      writeFileSync(targetFile, '// @generated crud:generate\nexport class TestService {}', 'utf8');

      const conflicts = service.detectConflicts(tempDir, ctx);
      expect(conflicts).toHaveLength(0);

      // 清理测试临时文件
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('当目标文件存在但缺少 @generated 标记时报告冲突', () => {
      const ctx = TemplateRenderer.buildContext('sample_product', [{ name: 'title', type: 'string', required: true }]);
      const tempDir = join(process.cwd(), PATHS.STORAGE_TMP, 'conflict-test-root');
      const targetFile = join(tempDir, 'src', 'features', 'admin', 'sampleProduct', 'sampleProduct.service.ts');

      mkdirSync(dirname(targetFile), { recursive: true });
      writeFileSync(targetFile, '// 手写核心业务代码，不可覆盖\nexport class CustomService {}', 'utf8');

      const conflicts = service.detectConflicts(tempDir, ctx);
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0]).toContain('拒绝覆盖');

      // 清理测试临时文件
      rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('updateAdminModuleExport()', () => {
    const adminModuleSource = [
      "import { Module } from '@nestjs/common';",
      "import { AdminDashboardModule } from './dashboard/dashboard.module';",
      "import { AdminUsersModule } from './users/users.module';",
      '',
      '@Module({',
      '  imports: [AdminUsersModule, AdminDashboardModule],',
      '})',
      'export class AdminModule {}',
      '',
    ].join('\n');

    let tempDir: string;
    let adminModulePath: string;

    beforeEach(() => {
      tempDir = join(process.cwd(), PATHS.STORAGE_TMP, 'admin-reg-test-root');
      adminModulePath = join(tempDir, 'src', 'features', 'admin', 'admin.module.ts');
      mkdirSync(dirname(adminModulePath), { recursive: true });
      writeFileSync(adminModulePath, adminModuleSource, 'utf8');
    });

    it('register 应追加 import 行与 imports 数组项（幂等）', () => {
      ArtifactWriter.updateAdminModuleExport(tempDir, 'sampleProduct', 'register');
      ArtifactWriter.updateAdminModuleExport(tempDir, 'sampleProduct', 'register');

      const content = readFileSync(adminModulePath, 'utf8');
      expect(content).toContain("import { SampleProductModule } from './sampleProduct/sampleProduct.module';");
      expect(content).toContain('imports: [AdminUsersModule, AdminDashboardModule, SampleProductModule]');

      rmSync(tempDir, { recursive: true, force: true });
    });

    it('unregister 应移除 import 行与数组项，恢复原状（幂等）', () => {
      ArtifactWriter.updateAdminModuleExport(tempDir, 'sampleProduct', 'register');
      ArtifactWriter.updateAdminModuleExport(tempDir, 'sampleProduct', 'unregister');
      ArtifactWriter.updateAdminModuleExport(tempDir, 'sampleProduct', 'unregister');

      const content = readFileSync(adminModulePath, 'utf8');
      expect(content).not.toContain('SampleProductModule');
      expect(content).toContain('imports: [AdminUsersModule, AdminDashboardModule]');

      rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('Client Scope & updateClientModuleExport()', () => {
    it('scope=client 时应正确构建 features 路径与客户端路由前缀', () => {
      const ctx = TemplateRenderer.buildContext(
        'product',
        [{ name: 'title', type: 'string', required: true }],
        'client',
      );

      expect(ctx.scope).toBe('client');
      expect(ctx.featureModulePath).toBe('features/client/product');
      expect(ctx.routePrefix).toBe('products');

      const tmplDir = resolve(process.cwd(), 'src/commands/generator/templates');
      const artifacts = TemplateRenderer.renderAll(tmplDir, ctx);

      const controllerArtifact = artifacts.find((a) => a.outputPath.endsWith('.controller.ts'));
      expect(controllerArtifact!.content).toContain("@Controller('products')");
      expect(controllerArtifact!.outputPath).toBe('src/features/client/product/product.controller.ts');
    });

    it('updateClientModuleExport 应在 src/features/index.ts 中追加/移除模块（幂等）', () => {
      const tempDir = join(process.cwd(), PATHS.STORAGE_TMP, 'client-reg-test-root');
      const apiIndexPath = join(tempDir, 'src', 'features', 'index.ts');
      const apiIndexSource = [
        "import { AdminModule } from '@/features/admin/admin.module';",
        "import { UsersModule } from '@/features/client/users/users.module';",
        '',
        'export const CLIENT_FEATURE_MODULES = [UsersModule] as const;',
        'export const FEATURE_MODULES = [UsersModule, AdminModule] as const;',
        '',
        "export * from '@/features/admin/admin.module';",
        "export * from '@/features/client/users/users.module';",
        '',
      ].join('\n');

      mkdirSync(dirname(apiIndexPath), { recursive: true });
      writeFileSync(apiIndexPath, apiIndexSource, 'utf8');

      // 注册
      ArtifactWriter.updateClientModuleExport(tempDir, 'product', 'register');
      let content = readFileSync(apiIndexPath, 'utf8');
      expect(content).toContain("import { ProductModule } from '@/features/client/product/product.module';");
      expect(content).toContain('export const CLIENT_FEATURE_MODULES = [UsersModule, ProductModule] as const;');
      expect(content).toContain('export const FEATURE_MODULES = [UsersModule, ProductModule, AdminModule] as const;');
      expect(content).toContain("export * from '@/features/client/product/product.module';");

      // 注销
      ArtifactWriter.updateClientModuleExport(tempDir, 'product', 'unregister');
      content = readFileSync(apiIndexPath, 'utf8');
      expect(content).not.toContain('ProductModule');
      expect(content).toContain('export const CLIENT_FEATURE_MODULES = [UsersModule] as const;');
      expect(content).toContain('export const FEATURE_MODULES = [UsersModule, AdminModule] as const;');

      rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
