ARG BUN_VERSION=1.4-alpine

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

COPY package.json bun.lock* bunfig.toml* ./
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun run build

# 生产依赖阶段：--omit=peer 剔除 Bun 连带装入的 optional peer（typescript/vitest 等）
FROM oven/bun:${BUN_VERSION} AS prod-deps
WORKDIR /app

COPY package.json bun.lock* bunfig.toml* ./
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
  bun install --production --omit=peer --frozen-lockfile --ignore-scripts

RUN apk add --no-cache tini \
  && mkdir -p storage/cache storage/tmp storage/uploads \
  && chown -R bun:bun storage

FROM oven/bun:${BUN_VERSION} AS production
WORKDIR /app

ENV NODE_ENV=production \
  APP_ENV=production \
  PORT=4400

COPY --from=prod-deps /sbin/tini /sbin/tini

# 代码与依赖保持 root 只读，仅 storage 可写：降低 RCE 后的篡改面
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=prod-deps --chown=bun:bun /app/storage ./storage

USER bun

EXPOSE 4400

ENTRYPOINT ["/sbin/tini", "--", "bun", "run", "dist/cli.js"]
CMD ["serve"]
