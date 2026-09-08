ARG BUN_VERSION=1-alpine

# --- Build Stage: 编译 TypeScript ---
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

# 1. 安装全量依赖（包含 devDependencies 与构建工具）
COPY package.json bun.lock* bunfig.toml* ./
RUN bun install --frozen-lockfile

# 2. 复制源码并构建
COPY . .
RUN bun run build

# --- Prod Deps Stage: 仅生产依赖 ---
FROM oven/bun:${BUN_VERSION} AS prod-deps
WORKDIR /app

COPY package.json bun.lock* bunfig.toml* ./
RUN bun install --production --frozen-lockfile

# --- Production Stage: 最小运行时 (Bun) ---
FROM oven/bun:${BUN_VERSION} AS production
WORKDIR /app
ENV NODE_ENV=production \
    APP_ENV=production \
    WORKER_EMBEDDED=true

# 复制生产依赖与构建产物（直接设定 1000 属主）
COPY --from=prod-deps --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/dist ./dist
COPY --from=build --chown=1000:1000 /app/package.json ./package.json

# 运行时存储目录（仅对 storage 设置权限，避免全盘 chown 导致 overlay2 镜像层膨胀）
RUN mkdir -p storage/cache storage/logs storage/tmp storage/uploads \
    && chown -R 1000:1000 storage

USER 1000

EXPOSE 4300

# 默认启动 HTTP 服务；Worker 进程由 K8s 通过 command 覆盖为 `bun run dist/workers/worker.main.js`。
# 健康检查交由 K8s probes 处理（镜像级 HEALTHCHECK 对无 HTTP 的 worker 进程会误报）。
CMD ["bun", "run", "dist/main.js"]


