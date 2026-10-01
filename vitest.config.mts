import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** 共享 SWC 插件配置（与 e2e config 保持一致） */
const swcPlugin = swc.vite({
  jsc: {
    parser: {
      syntax: 'typescript',
      decorators: true,
      dynamicImport: true,
    },
    transform: {
      legacyDecorator: true,
      decoratorMetadata: true,
    },
    target: 'es2024',
    keepClassNames: true,
  },
});

export default defineConfig({
  test: {
    globals: true,
    root: './',
    environment: 'node',
    env: {
      APP_ENV: 'testing',
    },
    include: ['tests/unit/**/*.test.ts'],
    /** 全局 setup：环境变量、日志抑制等 */
    setupFiles: ['./tests/setup.ts'],
    /** NestJS 模块编译可能较慢，放宽超时 */
    testTimeout: 10_000,
    /** 每次测试后自动恢复 mock/spy，防止交叉污染 */
    restoreMocks: true,
    clearMocks: true,
    /** 并行执行；fork 更隔离但启动慢，threads 适合单元测试 */
    pool: 'threads',
    /**
     * 每个测试文件独立的模块注册表（vitest 默认）。
     *
     * 曾被关闭以提速（worker 内模块只求值一次），但那会使隔离失效：模块注册表在同一 worker 内共享后，
     * 某文件先加载真实模块会令另一文件的 vi.mock 工厂失效（restoreMocks/clearMocks 只清理 spy 状态，
     * 无法撤销模块缓存）。实测后果是顺序执行时 features/admin/users/users.service.test.ts 中
     * 依赖 vi.mock('better-auth/crypto') 与 vi.mock('@/database/drizzle/drizzle-pagination') 的 4 个用例失败，
     * 而单跑或不同调度下通过 —— 典型的顺序依赖。套件整体代价约 +7s（并行 ~5.3s → ~12.4s），
     * 远低于一次随机失败带来的排查成本。
     */
    isolate: true,
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        '**/*.module.ts',
        '**/main.ts',
        '**/cli.ts',
        '**/cli.module.ts',
        'tests/**',
        '**/index.ts',
        'drizzle.config.ts',
      ],
      /** 当前未设硬阈值，待覆盖率提升后启用 */
      // thresholds: {
      //   lines: 60,
      //   branches: 50,
      //   functions: 60,
      //   statements: 60,
      // },
    },
    /** 输出精简：失败时展示 diff，CI 环境切 json */
    reporters: process.env.CI ? ['json', 'verbose'] : ['verbose'],
  },
  plugins: [swcPlugin],
  resolve: {
    alias: {
      '@': path.resolve('./src'),
      tests: path.resolve('./tests'),
    },
  },
});
