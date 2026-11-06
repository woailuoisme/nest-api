set shell := ["bash", "-uc"]
set dotenv-load

default:
    @just --list

# 释放端口占用（默认 PORT=4300，亦可指定：`just kill-port 8080`）
kill-port port=env("PORT", "4300"):
    kill -9 $(lsof -ti:{{ port }} 2>/dev/null) 2>/dev/null || true

# 启动开发服务器（API + Worker 双进程，process-compose 驱动）
dev *args='': kill-port
    process-compose up {{ args }}

# 启动生产全栈预览服务（构建产物 + API/Worker 双进程，process-compose 驱动）
start *args='': kill-port build
    process-compose -f process-compose.prod.yaml up {{ args }}

# 构建生产产物（SWC）
build:
    rm -rf dist && bun x nest build

# 提交前完整检查（格式化修复 + 类型 + 敏感凭据 + 多语言）
check: fix type secret i18n

# TypeScript 类型检查
type:
    bun x tsc --noEmit

# 静态代码检查
lint:
    bun x oxlint src tests

# 自动修复 Lint 并格式化
fix:
    bun x oxlint --fix src tests
    bun x oxfmt src tests

# 代码格式化
fmt:
    bun x oxfmt src tests

# 敏感凭据扫描（gitleaks）
secret *args='':
    gitleaks detect --verbose {{ args }}

# 单元测试
test *args='':
    bun x vitest run --config vitest.config.mts {{ args }}

# 单元测试（watch 模式）
watch:
    bun x vitest --config vitest.config.mts

# 单元测试覆盖率
cov:
    bun x vitest run --coverage --config vitest.config.mts

# E2E 端到端测试
e2e:
    bun x vitest run --config vitest.e2e.config.mts

# 生成 Drizzle 迁移 SQL
gen:
    bun x drizzle-kit generate

# 应用数据库迁移
migrate:
    bun scripts/repair-migration-journal.ts
    bun x drizzle-kit migrate

# 清空数据并灌入种子（保留表结构）
[confirm]
seed:
    just cmd db:seed --yes

# 删表重建 + 重跑迁移 + 灌入种子（破坏性）
[confirm]
fresh:
    just cmd db:seed --fresh --yes

# 启动 Drizzle Studio 可视化面板
studio:
    bun x drizzle-kit studio

# 编译 MJML 邮件模板为 Handlebars (.hbs)
mail:
    bash scripts/build-mail.sh

# 多语言 catalog 对称性校验
i18n:
    bun scripts/i18n-check.ts

# 构建并运行 CLI 命令（如 `just cmd route:list`）
cmd *args='--help':
    bun x nest build && node dist/cli.js {{ args }}
