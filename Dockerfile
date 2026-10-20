ARG BUN_VERSION=1.4-alpine

# --- Build Stage: 编译 TypeScript ---
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

# 1. 安装全量依赖（利用 BuildKit 隔离缓存挂载，避免缓存打入镜像层）
COPY package.json bun.lock* bunfig.toml* ./
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --ignore-scripts

# 2. 复制源码并构建
COPY . .
RUN bun run build

# --- Prod Deps Stage: 生产依赖与体积剪裁 ---
FROM oven/bun:${BUN_VERSION} AS prod-deps
WORKDIR /app

COPY package.json bun.lock* bunfig.toml* ./
# --omit=peer：Bun 会把生产依赖声明的 optional peers（typescript/vitest/tsx 等 devDeps）一并装入，
# 必须显式剔除，否则生产镜像泄漏 ~100MB 开发工具链
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
  bun install --production --omit=peer --frozen-lockfile --ignore-scripts

# 依赖剪裁：原生深度剔除静态非运行时资产（文档、测试、类型与源码映射），零外部网络依赖与多架构兼容
RUN set -eux; \
  find node_modules -type f \( \
  -name "*.d.ts" -o \
  -name "*.d.ts.map" -o \
  -name "*.map" -o \
  -name "*.tsbuildinfo" -o \
  -name "*.md" -o \
  -name "*.markdown" -o \
  -name "CHANGELOG*" -o \
  -name ".npmignore" \
  \) -delete; \
  find node_modules -type d \( \
  -name "test" -o \
  -name "tests" -o \
  -name "__tests__" -o \
  -name "docs" -o \
  -name "example" -o \
  -name "examples" \
  \) -prune -exec rm -rf {} + 2>/dev/null || true

# 安装轻量 init 进程 tini 并预置运行时存储目录（供生产阶段零 RUN 提取）
RUN apk add --no-cache tini \
  && mkdir -p storage/cache storage/tmp storage/uploads \
  && chown -R bun:bun storage

# --- Production Stage: 最小运行时 (Bun) ---
FROM oven/bun:${BUN_VERSION} AS production
WORKDIR /app

# OCI 镜像元数据标注与构建追踪
ARG GIT_COMMIT=""
ARG BUILD_TIME=""

LABEL org.opencontainers.image.title="Nest API" \
  org.opencontainers.image.description="Production-ready NestJS 12 enterprise backend with Drizzle ORM and Fastify" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.revision="${GIT_COMMIT}" \
  org.opencontainers.image.created="${BUILD_TIME}"

# 生产环境契约规范
ENV NODE_ENV=production \
  APP_ENV=production \
  PORT=4400 \
  HOST=0.0.0.0 \
  WORKER_EMBEDDED=false

# 1. 注入 init 进程与统一调度脚本
COPY --from=prod-deps /sbin/tini /sbin/tini
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

# 2. CIS 安全基线：核心代码与依赖保持 root:root 只读属主，防范 RCE 篡改；仅存储目录赋予应用用户写权限
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=prod-deps --chown=bun:bun /app/storage ./storage

USER bun

EXPOSE 4400

# 配置优雅停机信号，经由 tini 传递至 NestJS 触发 shutdown hooks 与连接池释放
STOPSIGNAL SIGTERM

ENTRYPOINT ["/sbin/tini", "--", "entrypoint.sh"]
CMD ["api"]
