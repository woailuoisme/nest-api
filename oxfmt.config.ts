import { defineConfig } from 'oxfmt';

export default defineConfig({
  // ── 对齐原 Biome 格式化基线：2 空格 / 120 列 / LF / 单引号 / 分号 / 尾逗号 ──
  printWidth: 120,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  endOfLine: 'lf',
  // ── 对齐原 Biome organizeImports（保存/just fix 时自动整理）──
  sortImports: true,
  ignorePatterns: ['**/*.hbs', '**/node_modules/**', '**/dist/**', '**/coverage/**'],
});
