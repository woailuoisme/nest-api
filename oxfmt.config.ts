import { defineConfig } from 'oxfmt';

export default defineConfig({
  // ── 格式化配置：120 列宽适配 NestJS 装饰器，单引号与全尾逗号 ──
  printWidth: 120,
  singleQuote: true,
  trailingComma: 'all',
  sortImports: true,
  ignorePatterns: ['**/*.hbs', '**/node_modules/**', '**/dist/**', '**/coverage/**'],
});

