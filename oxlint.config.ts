import { defineConfig } from 'oxlint';

// ── 插件（默认 eslint + typescript + oxc，此处追加 unicorn）──
export default defineConfig({
  plugins: ['typescript', 'unicorn'],
  // ── 正确性类规则整体启用（no-unreachable / no-unused-vars / no-unused-imports 等）──
  categories: {
    correctness: 'error',
  },
  rules: {
    // ── 代码风格 ──────────────────────────────────────────
    'no-param-reassign': 'error', // 禁止对参数重新赋值（避免意外修改外部引用）
    'typescript/prefer-as-const': 'error', // 强制字面量使用 as const（避免类型拓宽）
    'default-param-last': 'error', // 有默认值的参数必须放在最后
    'typescript/prefer-enum-initializers': 'error', // 枚举成员必须显式赋值（防止顺序依赖）
    'typescript/array-type': 'error', // 统一 T[]（默认 array 形态）
    'operator-assignment': 'error', // a = a + 1 → a += 1
    'unicorn/prefer-number-properties': 'error', // 用 Number.isNaN 而非 isNaN
    'no-else-return': 'error', // if 里 return 了就不需要 else
    'one-var': ['error', 'never'], // 禁止逗号连写多个变量声明
    // ── 可疑代码 ──────────────────────────────────────────
    'typescript/no-explicit-any': 'warn', // 显式 any 只警告（NestJS 装饰器/框架回调不可避免）
    'no-console': 'error', // 生产代码禁止 console.log（CLI/seeds 已豁免）
    // ── 复杂度 / 类型 ─────────────────────────────────────
    'typescript/no-empty-object-type': 'error', // 禁止 {} 空对象类型
    'typescript/no-wrapper-object-types': 'error', // 禁止 String/Number/Boolean 包装类
    'unicorn/no-static-only-class': 'error', // 只有静态成员的类 → 改用模块函数
    'no-useless-constructor': 'error', // 无用 constructor（如空的 super() 调用）
    'no-lone-blocks': 'error', // 消除只含单个语句的无意义独立块 { ... }
    // ── 迁移豁免：Biome 原配置未启用，且数组预分配为刻意性能模式 ──
    'unicorn/no-new-array': 'off',
  },
  ignorePatterns: ['node_modules', 'dist', 'coverage'],
  overrides: [
    // ── 测试文件：放宽限制 ────────────────────────────────
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
        'typescript/no-explicit-any': 'off', // mock 对象、动态断言不可避免
        'no-console': 'off', // 调试日志允写
        'no-unused-vars': 'off', // 部分变量仅用于断言链
        'no-param-reassign': 'off', // mock 回调中修改参数常见
      },
    },
    // ── CLI / Seeds：允许 console ───────────────────────────
    {
      files: ['src/commands/**/*.ts', 'src/database/seeds/**/*.ts', 'src/cli.ts'],
      rules: {
        'no-console': 'off', // CLI 输出、种子脚本日志是合理需求
      },
    },
  ],
});
