# nest-forge 的 justfile
# 运行 `just --list` 查看可用命令。

set shell := ["bash", "-uc"]
set dotenv-load := true

default:
    @just --list

# ----------------------------------------
# 开发
# ----------------------------------------

# 启动开发服务器（单进程内嵌 Worker，watch 模式）
dev:
    kill -9 $(lsof -ti:${PORT:-4300} 2>/dev/null) 2>/dev/null || true; WORKER_EMBEDDED=true nest start --watch

# 并发启动应用与 Worker（两个独立进程）
dev-all:
    concurrently -k -n app,worker -c bgBlue.bold,bgMagenta.bold -p "[{name}]" -t "HH:mm:ss" "nest start --watch" "nest start --entryFile workers/worker.main --watch"

# 以调试模式启动开发服务器
debug:
    bun x nest start --debug --watch

# 构建生产产物（SWC）
build:
    nest build

# 启动生产构建
start:
    node dist/main.js

# 仅启动 Worker（生产构建）
start-worker:
    node dist/workers/worker.main.js

# 启动应用（内嵌 Worker，单进程）
start-embedded:
    WORKER_EMBEDDED=true node dist/main.js

# 并发启动应用与 Worker（两个独立进程）
start-all:
    concurrently -k -n app,worker -c bgBlue.bold,bgMagenta.bold "node dist/main.js" "node dist/workers/worker.main.js"


# ----------------------------------------
# 质量与测试
# ----------------------------------------

# 检查代码格式、类型、AST 架构规则与多语言字典对称性
check: fix fmt type sg-lint sg-test i18n-check

# TypeScript 类型检查
type:
    bun x tsc --noEmit

# 代码 Lint
lint:
    bun x biome check src

# 运行 ast-grep 结构架构 Lint
sg-lint *args='':
    ast-grep scan {{args}}

# 运行 ast-grep 规则测试套件
sg-test *args='':
    ast-grep test {{args}}

# 查看文件或目录的结构大纲
outline *args='':
    ast-grep outline {{args}}

# 一键扫描项目中所有已废弃(@deprecated)的符号与函数
check-deprecated:
    node scripts/check-deprecated.ts

# 自动修复 Lint 与格式化
fix:
     bun x biome check --write --no-errors-on-unmatched src tests

# 使用 Biome 格式化代码
fmt:
    bun x biome format --write --no-errors-on-unmatched src tests

# 运行单元测试
test *args='':
    bun x vitest run --config vitest.config.mts {{args}}

# 以 watch 模式运行单元测试
test-watch:
    bun x vitest --config vitest.config.mts

# 打开 Vitest UI
test-ui:
    bun x vitest --config vitest.config.mts --ui

# 运行带覆盖率的单元测试
test-cov:
    bun x vitest run --coverage --config vitest.config.mts

# 运行 E2E 测试
test-e2e:
    bun x vitest run --config vitest.e2e.config.mts

# 使用 Node inspector 调试单元测试（断点调试）
test-debug *args='':
    bun x vitest --inspect-brk --no-file-parallelism --config vitest.config.mts {{args}}

# ----------------------------------------
# k6 负载与性能测试
# ----------------------------------------

# 按场景运行 k6 负载测试（如 `just k6 smoke`、`just k6 stress -e BASE_URL=...`）
k6 scenario='smoke' *args='':
    k6 run tests/k6/scenarios/{{scenario}}.js {{args}}

# 运行 k6 smoke 测试
k6-smoke *args='':
    k6 run tests/k6/scenarios/smoke.js {{args}}

# 运行 k6 average 负载测试
k6-load *args='':
    k6 run tests/k6/scenarios/load.js {{args}}

# 运行 k6 stress 测试
k6-stress *args='':
    k6 run tests/k6/scenarios/stress.js {{args}}

# 运行 k6 spike 测试
k6-spike *args='':
    k6 run tests/k6/scenarios/spike.js {{args}}

# 运行 k6 soak/耐力测试
k6-soak *args='':
    k6 run tests/k6/scenarios/soak.js {{args}}

# 在 Docker 容器内运行 k6（无需本地安装 k6 CLI）
k6-docker scenario='smoke' *args='':
    docker run --rm -i -e BASE_URL="http://host.docker.internal:4300" -v "$(pwd)/tests/k6:/scripts:ro" -v "$(pwd)/storage/logs:/storage/logs" grafana/k6 run /scripts/scenarios/{{scenario}}.js {{args}}

# ----------------------------------------
# 邮件模板
# ----------------------------------------

# 将 MJML 邮件模板编译为 Handlebars (.hbs)
mail-build:
    bash scripts/build-mail.sh

# ----------------------------------------
# 国际化 / i18n (nestjs-i18n)
# ----------------------------------------

# 生成 i18n TypeScript 强类型定义 (I18nTranslations / I18nPath)
i18n-gen:
    bun x nestjs-i18n -p src/i18n/translations -o src/i18n/i18n.generated.ts

# 校验各语言翻译字典的键值对称性与完整性
i18n-check:
    bun x nestjs-i18n check -p src/i18n/translations


# ----------------------------------------
# Drizzle / 数据库
# ----------------------------------------

# 生成 Drizzle 迁移
db-gen:
    bun x drizzle-kit generate

# 运行迁移（开发环境）
db-migrate:
    bun x drizzle-kit migrate

# 部署迁移（生产环境）
db-deploy:
    bun x drizzle-kit migrate

# 灌入种子数据
db-seed:
    bun x tsx src/database/seeds/index.ts

# 打开 Drizzle Studio
db-studio:
    bun x drizzle-kit studio

# 重置数据库（仅开发环境，破坏性操作——删除 schema 并重新迁移）
db-reset:
    bun x drizzle-kit drop
    bun x drizzle-kit migrate

# ----------------------------------------
# Better Auth 命令行
# ----------------------------------------

# 为 Better Auth 应用表结构变更（Drizzle 架构下生成并应用迁移 SQL）
ba-migrate:
    @echo "Better Auth 使用 Drizzle 适配器，正通过 drizzle-kit 生成并执行迁移..."
    just db-gen
    just db-migrate

# 为 Better Auth 生成 Drizzle Schema（覆盖输出到 better-auth.schema.ts）
ba-generate:
    bun x --bun auth generate --config src/common/auth/better-auth.ts --output src/database/drizzle/schema/better-auth.schema.ts -y

# 显示系统与 Better Auth 配置信息
ba-info:
    bun x --bun auth info --config src/common/auth/better-auth.ts

# 生成新的 Better Auth secret
ba-secret:
    bun x --bun auth secret

# ----------------------------------------
# CLI（nest-commander）
# ----------------------------------------

# 从生产构建运行 nest-commander CLI（如 `just cli jwt:secret`）
cli *args='--help':
    node dist/cli.js {{args}}

# 运行 nest-commander CLI（构建并运行 TS CLI，如 `just cmd jwt:secret`）
cmd *args='--help':
    nest build && node dist/cli.js {{args}}

# ----------------------------------------
# Helm
# ----------------------------------------

# Lint Helm chart
helm-lint:
    helm lint ./deploy/helm

# 校验 Helm chart（lint + template + kubeconform）
helm-validate:
    helm lint ./deploy/helm
    helm template nestforge ./deploy/helm | kubeconform -summary

# 打包 Helm chart
helm-package:
    helm package ./deploy/helm

# 安装/升级 Helm chart 到集群（需 kubeconfig）
helm-install *args='--dry-run':
    helm upgrade --install nestforge ./deploy/helm {{args}}
# 将密钥同步到 GitHub（需 gh CLI）
sync-secrets:
    bash scripts/sync-secrets.sh

# ----------------------------------------
# 容器运维 (Docker Compose)
# ----------------------------------------

# 启动全栈 Docker 容器集群 (API + Realtime)
docker-up *args='':
    docker network create backend 2>/dev/null || true
    docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d {{args}}

# 停止全栈 Docker 容器集群
docker-down *args='':
    docker compose -f deploy/docker-compose.yml --env-file deploy/.env down {{args}}

# 生成/更新 Mosquitto 凭据 (透传 mosquitto_passwd，用法: just mqtt-passwd -c -b /creds/password.txt <用户名> '<密码>')
mqtt-passwd *args='':
    docker run --rm -v "{{justfile_directory()}}/deploy/mosquitto/config/credentials:/creds" eclipse-mosquitto:2.1-alpine mosquitto_passwd {{args}}

# 初始化 Mosquitto ACL 规则文件 (从模板复制，随后按租户/设备调整)
mqtt-acl:
    cp deploy/mosquitto/config/acl.example deploy/mosquitto/config/credentials/acl.txt

# 启动 Centrifugo 实时服务容器
realtime:
    docker network create backend 2>/dev/null || true
    docker compose -f deploy/centrifugo/docker-compose.yml --env-file deploy/.env up -d realtime

# 停止 Centrifugo 实时服务容器
realtime-down:
    docker compose -f deploy/centrifugo/docker-compose.yml --env-file deploy/.env stop realtime

# 查看 Centrifugo 容器实时日志
realtime-logs:
    docker compose -f deploy/centrifugo/docker-compose.yml --env-file deploy/.env logs -f realtime

# 检查 Centrifugo 健康状态
realtime-health:
    curl -fsS http://localhost:8000/health || exit 1

# 兼容别名
centrifugo: realtime
centrifugo-down: realtime-down
centrifugo-logs: realtime-logs