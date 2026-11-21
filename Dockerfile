ARG BUN_VERSION=1.4-alpine

# 构建阶段：全量依赖 + SWC 编译
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

COPY package.json bun.lock* bunfig.toml* ./
# cache mount 只加速重复安装，不进镜像层
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun run build

# 生产依赖阶段：--omit=peer 剔除 Bun 连带装入的 optional peer（typescript/vitest 等）
FROM oven/bun:${BUN_VERSION} AS prod-deps
WORKDIR /app

COPY package.json bun.lock* bunfig.toml* ./
# 安装与瘦身必须同一条 RUN：否则文件留在上一层，删除只产生 whiteout，镜像体积不变
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
  bun install --production --omit=peer --frozen-lockfile --ignore-scripts \
  && find node_modules -type f \( \
    -name "*.d.ts" -o -name "*.d.ts.map" -o -name "*.map" \
    -o -name "*.md" -o -name "*.markdown" -o -name "CHANGELOG*" -o -name ".npmignore" \
  \) -delete \
  && rm -rf node_modules/swagger-ui-dist

RUN mkdir -p storage/cache storage/tmp storage/uploads \
  && chown -R bun:bun storage

# 运行时阶段：仅 dist 与生产依赖（alpine 变体保留 bun 非 root 用户与 shell，便于排障）
FROM oven/bun:${BUN_VERSION} AS production
WORKDIR /app

ENV NODE_ENV=production \
  APP_ENV=production \
  PORT=4400

# 代码与依赖保持 root 只读，仅 storage 可写：降低 RCE 后的篡改面
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=prod-deps --chown=bun:bun /app/storage ./storage

USER bun

EXPOSE 4400

# 进程类型由 CMD / 编排器决定（serve | worker）；换命令用 --entrypoint 覆盖
ENTRYPOINT ["bun", "run", "dist/cli.js"]
CMD ["serve"]
