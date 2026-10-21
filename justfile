# nest-api 的 justfile — 运行 `just` 或 `just --list` 查看命令（按分组展示）。
#
# 约定：
# - 命令名保持 `<域>-<动作>`（db-gen / i18n-check / ba-secret），不缩写、不改名；
# - 破坏性命令带 `[confirm]`，自动化场景用 `just --yes <recipe>` 跳过确认；
# - 别名仅用于同义入口（db-deploy / db-reset），不引入第二套命名。

set shell := ["bash", "-uc"]
set dotenv-load

default:
    @just --list

# 启动开发服务器（单进程内嵌 Worker，watch 模式）
[group('dev')]
dev:
    kill -9 $(lsof -ti:${PORT:-4300} 2>/dev/null) 2>/dev/null || true; WORKER_EMBEDDED=true nest start --watch

# 并发启动应用与 Worker（两个独立进程）
[group('dev')]
dev-all:
    concurrently -k -n app,worker -c bgBlue.bold,bgMagenta.bold -p "[{name}]" -t "HH:mm:ss" "nest start --watch" "nest start --entryFile workers/worker.main --watch"

# 构建生产产物（SWC）
[group('dev')]
build:
    nest build

# 启动生产构建（dist/main.js，不内嵌 Worker）
[group('dev')]
start:
    node dist/main.js

# 启动生产构建并内嵌 Worker（单进程）
[group('dev')]
start-embedded:
    WORKER_EMBEDDED=true node dist/main.js

# 仅启动 Worker（消费队列，不提供 HTTP）
[group('dev')]
start-worker:
    node dist/workers/worker.main.js

# 提交前完整检查（修复并格式化 → 类型 → 密钥 → 架构规则 → 多语言）
[group('quality')]
check: fix type secret-check rbac-check i18n-check

# TypeScript 类型检查（tsc --noEmit）
[group('quality')]
type:
    bun x tsc --noEmit

# Lint 静态检查（只检查不修改）
[group('quality')]
lint:
    bun x oxlint src tests

# 自动修复 Lint 并格式化（oxlint --fix + oxfmt）
[group('quality')]
fix:
    bun x oxlint --fix src tests
    bun x oxfmt src tests

# 仅格式化（oxfmt）
[group('quality')]
fmt:
    bun x oxfmt src tests

# 扫描密钥与敏感凭据泄漏（gitleaks，可追加参数）
[group('quality')]
secret-check *args='':
    gitleaks detect --verbose {{ args }}

# 扫描已废弃（@deprecated）的依赖与符号
[group('quality')]
check-deprecated:
    node scripts/check-deprecated.ts

# 运行单元测试（可追加 vitest 参数）
[group('test')]
test *args='':
    bun x vitest run --config vitest.config.mts {{ args }}

# watch 模式运行单元测试
[group('test')]
test-watch:
    bun x vitest --config vitest.config.mts

# 单元测试覆盖率报告
[group('test')]
test-cov:
    bun x vitest run --coverage --config vitest.config.mts

# E2E 端到端测试
[group('test')]
test-e2e:
    bun x vitest run --config vitest.e2e.config.mts

# 生成 Drizzle 迁移 SQL
[group('db')]
db-gen:
    bun x drizzle-kit generate

# 应用数据库迁移（开发与生产同一命令；生产入口用别名 db-deploy）
[group('db')]
db-migrate:
    bun x drizzle-kit migrate

# 应用数据库迁移（生产别名，等同 db-migrate）
alias db-deploy := db-migrate

# 清空所有表数据并灌入种子（保留表结构，破坏性）
[confirm]
[group('db')]
db-seed:
    just cmd db:seed --yes

# 删表重建 + 重跑迁移 + 灌种子（破坏性）
[confirm]
[group('db')]
db-fresh:
    just cmd db:seed --fresh --yes

# 重置数据库（别名，等同 db-fresh）
alias db-reset := db-fresh

# 启动 Drizzle Studio 可视化管理面板
[group('db')]
db-studio:
    bun x drizzle-kit studio

# 应用 Better Auth 表结构变更（生成迁移 + 执行）
[group('auth')]
ba-migrate:
    just db-gen
    just db-migrate

# 依据 better-auth.ts 重新生成 Drizzle Schema
[group('auth')]
ba-generate:
    bun x --bun auth generate --config src/common/auth/better-auth.ts --output src/database/drizzle/schema/better-auth.schema.ts -y

# 生成新的 Better Auth secret
[group('auth')]
ba-secret:
    bun x --bun auth secret

# 显示 Better Auth 与系统配置信息
[group('auth')]
ba-info:
    bun x --bun auth info --config src/common/auth/better-auth.ts

# 编译 MJML 邮件模板为 Handlebars (.hbs)
[group('codegen')]
mail-build:
    bash scripts/build-mail.sh

# 生成 i18n TypeScript 强类型定义
[group('codegen')]
i18n-gen:
    bun x nestjs-i18n -p src/i18n/translations -o src/i18n/i18n.generated.ts

# 校验各语言翻译字典的键值对称性
[group('codegen')]
i18n-check:
    bun x nestjs-i18n check -p src/i18n/translations

# 由 ROLE_PERMISSIONS 重新生成 Casbin 策略（policy.csv）
[group('codegen')]
rbac-gen:
    bun scripts/rbac-policy.gen.ts

# 校验 policy.csv 与 ROLE_PERMISSIONS 是否一致（漂移即非零退出，CI 用）
[group('codegen')]
rbac-check:
    bun scripts/rbac-policy.gen.ts --check

# 查看文件或目录的紧凑 AST 结构大纲（ast-grep）
[group('codegen')]
outline *args='':
    ast-grep outline {{ args }}

# 构建并运行 CLI（TS 源码入口，如 `just cmd route:list`）
[group('codegen')]
cmd *args='--help':
    nest build && node dist/cli.js {{ args }}

# 直接运行生产构建 CLI（要求已 just build / just cmd）
[group('codegen')]
cli *args='--help':
    node dist/cli.js {{ args }}
