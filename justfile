set shell := ["bash", "-uc"]
set dotenv-load

default:
    @just --list

# 释放端口占用（默认 PORT=4300，亦可指定：`just kill-port 8080`）
kill-port port=env("PORT", "4300"):
    bash scripts/tasks.sh kill-port {{ port }}

# 启动开发服务器（API + Worker 双进程，SWC watch 热更新；Ctrl-C 同时停止）
dev:
    bash scripts/tasks.sh dev

# 启动生产全栈预览服务（构建产物 + API/Worker 双进程；Ctrl-C 同时停止）
start:
    bash scripts/tasks.sh start

# 构建生产产物（SWC）
build:
    bash scripts/tasks.sh build

# 提交前完整检查（格式化和修复 + 类型 + 敏感凭据）
check: fix type secret

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

# 应用数据库迁移（先修复 journal，再执行 drizzle migrate）
migrate:
    bash scripts/tasks.sh migrate

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
    bash scripts/tasks.sh mail

# 构建并运行 CLI 命令（如 `just cmd route:list`）
cmd *args='--help':
    bash scripts/tasks.sh build && node dist/cli.js {{ args }}
