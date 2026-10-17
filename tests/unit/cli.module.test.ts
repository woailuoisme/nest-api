import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { AppModule } from '@/app.module';
import { CliModule } from '@/cli.module';

describe('CliModule', () => {
  it('应镜像导入 AppModule 中包含 Controller 的所有业务模块以保证 CLI 路由发现完整', () => {
    const appImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) || [];
    const cliImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, CliModule) || [];

    const cliImportSet = new Set(cliImports);

    // 过滤出 AppModule 中包含 controllers 元数据的模块
    const appControllerModules = appImports.filter((mod: unknown) => {
      if (typeof mod === 'function') {
        const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, mod);
        return Array.isArray(controllers) && controllers.length > 0;
      }
      return false;
    });

    for (const mod of appControllerModules) {
      expect(
        cliImportSet.has(mod),
        `CliModule 遗漏导入业务模块 [${(mod as { name: string }).name}]，请同步导入以支持 CLI 路由发现`,
      ).toBe(true);
    }
  });

  it('AppModule 与 CliModule 均应完整引入 FEATURE_MODULES', async () => {
    const { FEATURE_MODULES } = await import('@/features');
    const appImports = new Set(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) || []);
    const cliImports = new Set(Reflect.getMetadata(MODULE_METADATA.IMPORTS, CliModule) || []);

    for (const mod of FEATURE_MODULES) {
      expect(appImports.has(mod), `AppModule 应包含 ${mod.name}`).toBe(true);
      expect(cliImports.has(mod), `CliModule 应包含 ${mod.name}`).toBe(true);
    }
  });
});
