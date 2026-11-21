set shell := ["bash", "-uc"]
set dotenv-load

app_port := env("APP_PORT", "4300")

default:
    @just --list

# 释放端口占用（默认 PORT=4300，亦可指定：`just kill-port 8080`）
kill-port port=env("PORT", "4300"):
    lsof -ti:{{ port }} | xargs kill -9 2>/dev/null || true

# 启动开发服务器（dekit 管理 API + Worker 双进程并进入 TUI）
dev:
    dekit start 'dev/*'
    dekit attach

# 启动生产全栈预览服务（dekit 构建产物并拉起 API + Worker）
start: build
    dekit start 'prod/*'
    dekit attach

# 停止 dekit 托管的所有进程
down:
    dekit down

# 查看 dekit 任务状态
ps:
    dekit ls

# 附加到 dekit TUI 控制台
attach:
    dekit attach

# 构建生产产物（SWC）
build:
    if [ -d dist ]; then find dist -mindepth 1 -delete; fi
    bun x nest build

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
    for file in src/common/mail/templates/src/*.mjml; do \
        name="$(basename "$file" .mjml)"; \
        bun x mjml "$file" -o "src/common/mail/templates/${name}.hbs" --config.allowIncludes true; \
        echo "compiled ${name}.hbs"; \
    done

# 构建并运行 CLI 命令（如 `just cmd route:list`）
cmd *args='--help': build
    node dist/cli.js {{ args }}

# 压测（wrk）
wrk path="/livez" *args="":
    wrk -t4 -c200 -d30s --latency {{args}} "http://127.0.0.1:{{app_port}}{{path}}"

oha:
	oha -z 30s -c 200 --latency-correction http://127.0.0.1:{{app_port}}/livez
