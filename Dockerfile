ARG BUN_VERSION=1.4-alpine

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

COPY package.json bun.lock* bunfig.toml* ./
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun run build

FROM oven/bun:${BUN_VERSION} AS prod-deps
WORKDIR /app

COPY package.json bun.lock* bunfig.toml* ./
# 安装与瘦身必须同一条 RUN（分层后再删只产生 whiteout）；--omit=peer 剔除 Bun 连带装入的 optional peer
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
  bun install --production --omit=peer --frozen-lockfile --ignore-scripts \
  && find node_modules -type f \( \
    -name "*.d.ts" -o -name "*.d.ts.map" -o -name "*.map" \
    -o -name "*.md" -o -name "*.markdown" -o -name "CHANGELOG*" -o -name ".npmignore" \
  \) -delete \
  && rm -rf node_modules/swagger-ui-dist

RUN mkdir -p storage/cache storage/tmp storage/uploads \
  && chown -R bun:bun storage

FROM oven/bun:${BUN_VERSION} AS production
WORKDIR /app

ENV NODE_ENV=production \
  APP_ENV=production \
  PORT=4400

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=prod-deps --chown=bun:bun /app/storage ./storage

USER bun

EXPOSE 4400

ENTRYPOINT ["bun", "run", "dist/cli.js"]
CMD ["serve"]
