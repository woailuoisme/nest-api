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

# 启动开发服务器（API + Worker 双进程，watch 模式；两个进程均经 CLI 前门启动）
# 共用 dist/，故 nest-cli.json 关闭 deleteOutDir（否则两者互相清空 → MODULE_NOT_FOUND）
[group('dev')]
dev:
    kill -9 $(lsof -ti:${PORT:-4300} 2>/dev/null) 2>/dev/null || true; concurrently -k -n app,worker -c bgBlue.bold,bgMagenta.bold -p "[{name}]" -t "HH:mm:ss" "nest start --watch --entryFile cli -- serve" "nest start --watch --entryFile cli -- worker"

# 构建生产产物（SWC）
[group('dev')]
build:
    rm -rf dist && nest build

# 启动生产构建（CLI 前门 serve）— 仅 HTTP API，队列由独立 worker 进程消费
[group('dev')]
serve:
    node dist/cli.js serve

# 启动生产构建（CLI 前门 worker）— 消费队列与定时任务，不提供 HTTP
[group('dev')]
worker:
    node dist/cli.js worker

# 提交前完整检查（修复并格式化 → 类型 → 密钥 → 架构规则 → 多语言）
[group('quality')]
check: fix type secret-check i18n-check

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
    bun scripts/repair-migration-journal.ts
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

# 编译 MJML 邮件模板为 Handlebars (.hbs)
[group('codegen')]
mail-build:
    bash scripts/build-mail.sh

# 校验各语言目录的键、占位符与复数形式对称性（官方 JsonI18nLoader）
[group('codegen')]
i18n-check:
    bun scripts/i18n-check.ts

# 查看文件或目录的紧凑 AST 结构大纲（ast-grep）
[group('codegen')]
outline *args='':
    ast-grep outline {{ args }}

# 构建并运行 CLI（TS 源码入口，如 `just cmd route:list`）
[group('codegen')]
cmd *args='--help':
    nest build && node dist/cli.js {{ args }}

# 直接运行生产构建 CLI（容器 verb: cli；要求已 just build / just cmd）
[group('codegen')]
cli *args='--help':
    node dist/cli.js {{ args }}
