import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['typescript'],
  categories: {
    correctness: 'error',
  },
  rules: {
    // ── 核心安全与质量约束 ─────────────────────────────────────
    'no-param-reassign': 'error',
    'no-console': 'error',
    'typescript/no-explicit-any': 'warn',
    'typescript/prefer-as-const': 'error',
    'typescript/prefer-enum-initializers': 'error',
    'typescript/no-empty-object-type': 'error',
    'typescript/no-wrapper-object-types': 'error',
  },
  ignorePatterns: ['node_modules', 'dist', 'coverage'],
  overrides: [
    // ── 测试文件：放宽 Mock 与断言约束 ───────────────────────
    {
      files: [
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/*.e2e-test.ts',
        'tests/**/*.ts',
        'tests/**/*.js',
        '**/factories/**/*.ts',
        '**/mocks/**/*.ts',
      ],
      rules: {
        'typescript/no-explicit-any': 'off',
        'no-console': 'off',
        'no-unused-vars': 'off',
        'no-param-reassign': 'off',
      },
    },
    // ── CLI 与种子脚本：允许标准输出日志 ─────────────────────
    {
      files: ['src/commands/**/*.ts', 'src/database/seeds/**/*.ts', 'src/cli.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
});

