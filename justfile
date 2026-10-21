# nest-api 的 justfile
# 运行 `just` 或 `just --list` 查看可用命令。

set shell := ["bash", "-uc"]
set dotenv-load := true

default:
    @just --list

# ----------------------------------------
# 开发与运行
# ----------------------------------------

# 启动开发服务器（单进程内嵌 Worker，watch 模式）
dev:
    kill -9 $(lsof -ti:${PORT:-4300} 2>/dev/null) 2>/dev/null || true; WORKER_EMBEDDED=true nest start --watch

# 并发启动应用与 Worker（两个独立进程）
dev-all:
    concurrently -k -n app,worker -c bgBlue.bold,bgMagenta.bold -p "[{name}]" -t "HH:mm:ss" "nest start --watch" "nest start --entryFile workers/worker.main --watch"

# 构建生产产物（SWC）
build:
    nest build

# 启动生产构建
start:
    node dist/main.js

# 启动应用（内嵌 Worker，单进程）
start-embedded:
    WORKER_EMBEDDED=true node dist/main.js

# 仅启动 Worker（生产构建）
start-worker:
    node dist/workers/worker.main.js

# ----------------------------------------
# 质量与门禁
# ----------------------------------------

# 提交前完整检查 (修复 + 格式化 + 类型 + 敏感信息 + 架构规则 + 多语言)
check: fix fmt type secret-check rbac-check i18n-check

# TypeScript 类型检查
type:
    bun x tsc --noEmit

# 代码 Lint 静态检查
lint:
    bun x oxlint src tests

# 自动修复 Lint 并格式化
fix:
    bun x oxlint --fix src tests
    bun x oxfmt src tests

# 格式化代码 (oxfmt)
fmt:
    bun x oxfmt src tests

# 扫描潜在密钥与敏感凭据泄漏 (gitleaks)
secret-check *args='':
    gitleaks detect --verbose {{args}}

# 扫描项目中已废弃 (@deprecated) 的依赖与符号
check-deprecated:
    node scripts/check-deprecated.ts

# 查看文件或目录的紧凑 AST 结构大纲
outline *args='':
    ast-grep outline {{args}}

# ----------------------------------------
# 测试与基准压测
# ----------------------------------------

# 运行 Vitest 单元测试
test *args='':
    bun x vitest run --config vitest.config.mts {{args}}

# 以 watch 模式运行单元测试
test-watch:
    bun x vitest --config vitest.config.mts

# 运行单元测试覆盖率报告
test-cov:
    bun x vitest run --coverage --config vitest.config.mts

# 运行 E2E 端到端集成测试
test-e2e:
    bun x vitest run --config vitest.e2e.config.mts

bench path="/livez" *args="":
    wrk -t4 -c200 -d30s --latency {{args}} "http://localhost:${APP_PORT:-4300}{{path}}"

# ----------------------------------------
# 数据库与迁移 (Drizzle)
# ----------------------------------------

# 生成 Drizzle 迁移 SQL
db-gen:
    bun x drizzle-kit generate

# 运行数据库迁移 (开发与生产)
db-migrate:
    bun x drizzle-kit migrate

alias db-deploy := db-migrate

# 清空所有表数据并灌入种子（保留表结构）
db-seed:
    just cmd db:seed --yes

# 删表重建 + 重跑迁移 + 灌种子 (破坏性)
db-fresh:
    just cmd db:seed --fresh --yes

# 启动 Drizzle Studio 可视化管理面板
db-studio:
    bun x drizzle-kit studio

# 重置数据库 (破坏性，等同 db-fresh：删表重建 + 迁移 + 种子)
db-reset: db-fresh

# ----------------------------------------
# 认证 (Better Auth)
# ----------------------------------------

# 为 Better Auth 应用表结构变更
ba-migrate:
    just db-gen
    just db-migrate

# 依据 better-auth.ts 重新生成 Drizzle Schema
ba-generate:
    bun x --bun auth generate --config src/common/auth/better-auth.ts --output src/database/drizzle/schema/better-auth.schema.ts -y

# 生成新的 Better Auth secret
ba-secret:
    bun x --bun auth secret

# 由 ROLE_PERMISSIONS 重新生成 Casbin 策略 (policy.csv)
rbac-gen:
    bun scripts/rbac-policy.gen.ts

# 校验 policy.csv 与 ROLE_PERMISSIONS 是否一致（漂移即非零退出，CI 用）
rbac-check:
    bun scripts/rbac-policy.gen.ts --check

# 显示系统与 Better Auth 配置信息
ba-info:
    bun x --bun auth info --config src/common/auth/better-auth.ts

# ----------------------------------------
# 工程化与代码生成
# ----------------------------------------

# 编译 MJML 邮件模板为 Handlebars (.hbs)
mail-build:
    bash scripts/build-mail.sh

# 生成 i18n TypeScript 强类型定义
i18n-gen:
    bun x nestjs-i18n -p src/i18n/translations -o src/i18n/i18n.generated.ts

# 校验各语言翻译字典的键值对称性
i18n-check:
    bun x nestjs-i18n check -p src/i18n/translations

# 运行 TS CLI（构建并执行 TS 命令行，如 `just cmd route:list`）
cmd *args='--help':
    nest build && node dist/cli.js {{args}}

# 运行生产构建 CLI (node dist/cli.js)
cli *args='--help':
    node dist/cli.js {{args}}

