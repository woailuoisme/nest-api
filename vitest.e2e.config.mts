import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** 共享 SWC 插件配置（与 unit config 保持一致） */
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
    include: ['tests/e2e/**/*.e2e-test.ts'],
    /** 全局 setup：环境变量、日志抑制等 */
    setupFiles: ['./tests/setup.ts'],
    /** E2E 测试启动 NestJS 应用，需要更多时间 */
    testTimeout: 15_000,
    hookTimeout: 30_000,
    /** E2E 要求进程隔离，避免端口/状态冲突 */
    pool: 'forks',
    /** 串行执行 E2E 测试（避免端口占用） */
    fileParallelism: false,
    /** 每次测试后自动恢复 mock/spy */
    restoreMocks: true,
    clearMocks: true,
  },
  plugins: [swcPlugin],
  resolve: {
    alias: {
      '@': path.resolve('./src'),
      tests: path.resolve('./tests'),
    },
  },
});
