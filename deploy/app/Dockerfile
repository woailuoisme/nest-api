ARG BUN_VERSION=1.4-alpine

# --- Build Stage: 编译 TypeScript ---
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

# 1. 安装全量依赖（利用 BuildKit 缓存挂载，避免缓存打入镜像层）
COPY package.json bun.lock* bunfig.toml* ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts

# 2. 复制源码并构建
COPY . .
RUN bun run build

# --- Prod Deps Stage: 生产依赖与体积剪裁 ---
FROM oven/bun:${BUN_VERSION} AS prod-deps
WORKDIR /app
ARG TARGETARCH

COPY package.json bun.lock* bunfig.toml* ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile --ignore-scripts

# 依赖剪裁：优先尝试 node-prune 深度剔除 .d.ts、.md、测试用例等非运行时资产，失败自动降级为原生 find 剪裁
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) ARCH="amd64" ;; \
      arm64) ARCH="arm64" ;; \
      *) ARCH="amd64" ;; \
    esac; \
    PRUNE_URL="https://github.com/tj/node-prune/releases/download/v1.3.0/node-prune_1.3.0_linux_${ARCH}.tar.gz"; \
    if wget -q -O /tmp/node-prune.tar.gz "${PRUNE_URL}" 2>/dev/null && tar -xzf /tmp/node-prune.tar.gz -C /usr/local/bin node-prune 2>/dev/null; then \
      rm -f /tmp/node-prune.tar.gz; \
      node-prune /app/node_modules; \
    else \
      rm -f /tmp/node-prune.tar.gz; \
      find node_modules -type f \( -name "*.d.ts" -o -name "*.d.ts.map" -o -name "*.map" -o -name "*.md" -o -name "*.markdown" \) -delete; \
    fi

# 预创建运行时存储目录并配置属主（为最终阶段实现零 RUN 指令，杜绝额外 overlay 分层）
RUN mkdir -p storage/cache storage/tmp storage/uploads \
    && chown -R bun:bun storage

# --- Production Stage: 最小运行时 (Bun) ---
FROM oven/bun:${BUN_VERSION} AS production
WORKDIR /app
ENV NODE_ENV=production \
    APP_ENV=production \
    WORKER_EMBEDDED=true

# 复制生产依赖、预置存储目录与构建产物（全部通过 COPY 注入，终态 0 个 RUN 指令）
COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=prod-deps --chown=bun:bun /app/storage ./storage
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/package.json ./package.json

USER bun

EXPOSE 4300

# 默认启动 HTTP 服务；Worker 进程由 K8s 通过 command 覆盖为 `bun run dist/workers/worker.main.js`。
# 健康检查交由 K8s probes 处理（镜像级 HEALTHCHECK 对无 HTTP 的 worker 进程会误报）。
CMD ["bun", "run", "dist/main.js"]
