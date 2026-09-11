# AGENTS.md

本文件为 AI 编码助手提供项目上下文与协作规范，请在动手前完整阅读。

## 项目概览

**NestForge** — 生产级 NestJS 企业后端脚手架。

- 运行时: Bun ≥ 1.2 + Node ≥ 24，纯 ESM（`"type": "module"`）
- 框架: NestJS 12 + Fastify 5（非 Express）· ORM: Drizzle 0.45（PostgreSQL 多文件 schema）· 校验: Zod 4 · Redis + BullMQ
- 构建: SWC（`resolveFully`），类型检查 `tsc --noEmit` · 测试: Vitest 4 · Lint/格式: Biome 2 · 任务: Just
- 工具库: es-toolkit（唯一首选，严禁 Lodash）· 日志: 原生 Pino（`pino-roll` 按日切割）

## 常用命令

```bash
just dev          # 开发模式 (单进程内嵌 Worker + watch)
just dev-all      # 开发模式 (双进程并发 + watch)
just start-embedded # 生产模式 (单进程内嵌 Worker)
just build        # 构建到 dist/
just type         # tsc --noEmit 类型检查
just lint         # biome check src
just fix          # biome --write (src tests)
just fmt          # biome format --write
just sg-lint      # ast-grep 架构规则静态检查
just sg-test      # ast-grep 规则单测 (rule-tests)
just outline <path> # 查看文件或目录的紧凑 AST 结构大纲
just check-deprecated # 一键全库扫描已废弃 (@deprecated) 的第三方/原生函数
just check        # fix + fmt + type + sg-lint + sg-test (提交前完整检查)
just test         # 单元测试
just test-e2e     # E2E 测试
just test-cov     # 单测 + 覆盖率
just test-watch   # 单测 watch 模式

# Drizzle
just db-gen       # 生成迁移 SQL (drizzle-kit generate)
just db-migrate   # 应用迁移 (dev)
just db-deploy    # 应用迁移 (prod)
just db-seed      # 灌种子数据
just db-studio    # Drizzle Studio
just db-reset     # 重置数据库 (destructive)

# CLI (nest-commander)
just cmd --help           # 查看所有命令 (直接跑 TS 源码)
just cmd route:list       # 列出所有路由
just cmd jwt:secret       # 生成 JWT 密钥
just cli --help           # 运行生产构建 CLI (node dist/cli.js)
```

运行 TS CLI：`just cmd <command>`，或生产构建 CLI：`just cli <command>`。

## 目录结构

```text
src/database/
├── drizzle/        # Drizzle 表定义 + 数据库服务
│   ├── schema/     # 多文件 schema (better-auth.schema.ts, notifications.schema.ts 等, 汇总于 index.ts)
│   ├── sql/        # 原生 PostgreSQL DDL (00_init.sql, 01_auth.sql 等按 00~99 命名，供 DBA 审计与独立建表)
│   ├── drizzle.module.ts  # @Global() Drizzle 模块
│   └── drizzle.service.ts # postgres.js + drizzle 客户端
└── seeds/          # 种子数据 (user.seed.ts, index.ts)
src/
├── common/         # 全局 Filter/Guard/Interceptor/Pipe/Decorator/DTO/utils
│   ├── constants/  # PATHS、NETWORK、Role、Permission 等常量
│   ├── decorators/ # @Roles() @Permissions() @CurrentUser() 等
│   ├── excel/      # ExcelJS 封装
│   ├── media/      # 媒体处理服务 (imgproxy JIT动态实时渲染/纯JS元数据/矢量二维码/命名策略)
│   ├── mqtt/       # MQTT 5.0 客户端与指令/遥测总线 (@MqttSubscribe/@MqttPayload/RPC)
│   ├── realtime/   # 统一实时发布核心 (对齐 Laravel Broadcasting)：Centrifugo 纯粹无状态实时发布中枢
│   │   ├── channels/           # 模式匹配频道鉴权 (channel-manager.service.ts, presence.service.ts, @ChannelAuth)
│   │   ├── transports/         # 传输层契约与 Centrifugo 适配器 (centrifugo.transport.ts)
│   │   ├── realtime.dto.ts        # 信封结构 RealtimeEnvelope<T> 与客户端订阅传输对象
│   │   ├── realtime.service.ts    # 领域发布服务 (向 Centrifugo HTTP API 安全派发事件)
│   │   └── realtime.module.ts     # @Global 实时深模块 (纯发布引擎)
│   ├── resilience/ # 熔断 (CircuitBreaker) / 优雅限流 / 过载保护 (LoadShedding)
│   ├── search/     # Laravel Scout 风格搜索引擎抽象 (Meilisearch / Noop / 队列异步同步)
│   └── storage/    # 本地/S3 驱动 (drivers/local.driver.ts, s3.driver.ts)
├── config/         # env.validation.ts (Zod schema)
├── database/       # drizzle/ + bull.config.ts + redis.module.ts
├── commands/       # nest-commander CLI (route-list, db-seed, jwt-secret, search)
├── i18n/           # nestjs-i18n 配置
├── features/       # 统一业务特性层 (client: 客户端业务特性 / system: 系统基础设施 / admin: 后台管理自包含领域)
│   ├── client/     # 客户端特性模块 (auth, users)
│   ├── system/     # 系统/基础设施业务模块 (health, iot, websocket, sse)
│   ├── admin/      # 后台管理领域模块 (dashboard, notifications, users, admin.module.ts)
│   └── index.ts    # 聚合导出 FEATURE_MODULES
├── jobs/           # 异步任务与队列 (对齐 Laravel app/Jobs)：jobs 契约+生产者 / processor 消费者
│   ├── demo/           # 演示队列 (demo.jobs.ts, demo.processor.ts)
│   ├── mail/           # 邮件队列
│   ├── media/          # 媒体处理队列 (media.jobs.ts, media.processor.ts)
│   ├── search/         # 搜索同步队列 (search.jobs.ts, search.processor.ts)
│   ├── token-cleanup/  # Token 清理队列
│   └── jobs.module.ts  # @Global 生产者侧（registerQueue + Jobs）
├── schedules/      # 调度声明 (对齐 Laravel routes/console.php)：集中注册定时任务
│   ├── schedules.module.ts # 聚合所有 *Schedule
│   └── *.schedule.ts      # 每个定时任务一个文件，挂入 SchedulesModule
├── workers/        # 独立 Worker 进程 (worker.main.ts)：只消费队列
├── setup/          # Fastify 插件、中间件、Swagger/Scalar UI
│   └── logger/     # 原生 PinoLoggerService + LoggerModule + 日志流配置
├── app.module.ts   # 主模块
├── cli.module.ts   # CLI 入口模块
├── cli.ts          # CLI bootstrap
└── main.ts         # HTTP bootstrap
storage/            # 运行时数据 (cache/logs/tmp/uploads，git 忽略内容)
tests/
├── setup.ts            # 全局 setup（环境变量、mock 重置）
├── factories/          # 可复用的测试数据工厂
│   ├── user.factory.ts
│   └── token.factory.ts
├── mocks/              # 共享 Drizzle/Manager mock 工厂
│   └── drizzle.mock.ts
├── unit/               # 单元测试 (*.test.ts)
├── e2e/                # E2E 测试 (*.e2e-test.ts)
└── k6/                 # k6 性能与负载测试套件 (config.js, client.js, workflow.js, scenarios/)
```

## 关键约定

### 路径别名

`@/*` → `./src/*` (tsconfig + vitest + biome 均已配置)。优先用别名导入。

### 模块组织

- 业务模块统一按端归入 `src/features/`：
  - 客户端特性放 `src/features/client/<feature>/`，每个模块自带 `*.module.ts`、`*.controller.ts`、`*.service.ts`、`*.dto.ts`。
  - 系统/基础设施端点（如健康检查）放 `src/features/system/<feature>/`。
  - 管理后台领域放 `src/features/admin/<feature>/`，由 `src/features/admin/admin.module.ts` 聚合并强制 `/admin` 前缀与 `AdminPrefixGuard` 准入。
- **Admin / 前端 API 边界**: 后台管理领域（users / notifications / dashboard / admins / auth）的 controller + service + DTO 全部自包含于 `src/features/admin/`，由 `AdminModule` 聚合成唯一管理面入口并纳入 `FEATURE_MODULES`；准入由全局 `AdminPrefixGuard` 默认拒绝式强制（仅限合法管理角色 SUPER_ADMIN / ADMIN / OPERATOR，支持显式 `@Public()` 白名单豁免如 `/admin/auth/login`）。前端自助模块 `src/features/client/users/` 自包含自有 service 与 DTO（仅 `/users/me`、`/users/:id`、头像上传），与 admin 管理面零依赖；`AuthModule` 基于 Drizzle 客户端直接原子落库，与 `AdminUsersModule` 彻底解耦零依赖。**新增管理端点必须落在 `src/features/admin/`，严禁混入前端 controller**；`crud:generate` 产物支持 `--scope=admin|client` 分流，admin 产物自动落入该边界（`src/features/admin/<feature>/`）并自动注册进 `AdminModule`。
- **扁平数据访问**：Service 层直接使用 `@InjectDb() private readonly db: DrizzleDB` 注入数据库客户端，通过 `this.db.query...` / `this.db.insert...` 进行类型安全操作，不设多余的 Repository 样板层。
- **多写原子事务 (Transaction)**：涉及多表关联写入（如创建用户并绑定 OAuth 账户）或多步更新时，使用显式原生闭包 `await this.db.transaction(async (tx) => { ... })` 保证强一致性与自动回滚。
- **实时通信与领域事件解耦 (Decoupled Realtime & Events)**：所有 WebSocket 与 SSE 实时通信逻辑集中且自包含于 `src/features/system/{websocket,sse}/`（对齐 IoT 模块形态），包括各协议特有的频道常量、`@ChannelAuth` 准入鉴权、连接/订阅 Token 签发（`/v1/{websocket,sse}/*`）与频道列表。普通业务模块（如 `admin/notifications`）严禁直接注入实时服务或定义特定协议的频道规则，统一通过 `@nestjs/event-emitter` 向事件总线发布纯净领域事件（如 `notification.sent`）；`WebsocketService` 与 `SseService` 监听领域事件并负责向 Centrifugo 下发推送，实现业务与通信协议的单向彻底解耦。
- 全局基础设施 (Storage/Excel/Mail/Drizzle/Redis) 放 `src/common/` 或 `src/database/`，用 `@Global()` 导出。

### 环境变量

- `src/config/env.validation.ts` 用 Zod 定义所有 env，启动时强制校验。
- **全 URL 统一配置规范**：核心连接统一采用单一 DSN / URL 格式收敛，彻底摒弃散装 HOST/PORT/PASSWORD：
  - **Database**: `DB_URL="postgresql://user:pass@host:5432/dbname?schema=public"`
  - **Redis**: `REDIS_URL="redis://:password@host:6379/0"`（或 `rediss://...`）
  - **Mail**: `MAIL_URL="smtp://user:pass@host:587"`（发件人保持 `MAIL_FROM_ADDRESS` / `MAIL_FROM_NAME`）
  - **S3 Storage**: `STORAGE_S3_URL="s3://key:secret@endpoint:port/bucket?region=...&publicUrl=..."`
  - **Realtime (Centrifugo)**: `REALTIME_URL="centrifugo://api-key:hmac-secret@host:port/api?tls=false"`
  - **Imgproxy**: `IMGPROXY_URL="imgproxy://key:salt@host:port?publicUrl=..."`（支持 HMAC-SHA256 安全签名与多驱动映射）
- 新增 env 必须**同步更新** validation schema 与 `.env.example`。
- `.env` 由 `dotenv/config` 在 `drizzle.config.ts` 与 CLI 入口加载。

### Drizzle 多文件 Schema

- schema 文件放 `src/database/drizzle/schema/*.schema.ts`，由 `drizzle.config.ts` 聚合 (`schema: './src/database/drizzle/schema/*.schema.ts'`)。
- 表定义用 `pgTable()`，关系用 `relations()`，跨文件直接 import；`schema/index.ts` 统一 re-export 供 DrizzleService 使用。
- `src/database/drizzle/sql/` 提供与 Schema 严格对齐的纯净 PostgreSQL DDL (`00_init.sql`, `01_auth.sql` 等按 00~99 命名)，供快速建库、容器初始化与 DBA 审计。
- 修改 schema 后：`just db-gen` (生成迁移 SQL) → 检查生成的 SQL → `just db-migrate` → 迁移文件提交到仓库。

### 鉴权

- **Better Auth**（`src/common/auth/better-auth.ts`）：Drizzle 适配器，基础路径 `/v1/auth`，默认 `emailAndPassword`，会话 token 存库可吊销；邮件通过 `MailJobs` 队列分发。
- 插件全家桶：`admin` (RBAC) / `twoFactor` / `username` / `phoneNumber` / `magicLink` / `emailOTP` / `passkey` / `oneTap` / `anonymous` / `genericOAuth` (Google) / `apiKey` / `organization` / `bearer` / `multiSession` / `lastLoginMethod` / `jwt` / `deviceAuthorization` / `openAPI`。
- 角色: `SUPER_ADMIN / ADMIN / OPERATOR / USER`（`src/common/constants/roles.ts`），统一用户主表 `user`（UUID `uuidv7()`），前台用户与后台管理员聚合于同一张表。
- 细粒度权限: `@Roles(Role.ADMIN)` 角色级 + `@Permissions(Permission.UserCreate)` 声明式，配合 `BetterAuthGuard` / `AccessControlGuard` 兜底。

### CLI 模块 (`src/cli.module.ts`)

独立于 `AppModule` 且免除 HTTP 守卫与 Worker 额外开销。所有带 Controller 的业务模块统一在 `src/features/index.ts` 中的 `FEATURE_MODULES` 集中声明，`AppModule` 与 `CliModule` 统一展开引入，彻底消除路由发现缺失与模块漂移。
BullMQ 队列由 `AuthModule → MailJobs` 依赖，CLI 模块也需 `BullModule.forRootAsync(...)`。

## 编码规范

- **格式**: Biome 强制 single quote / semicolon / 2-space / 120 列 / LF / es5 trailing comma。
- **import 排序**: `assist.actions.source.organizeImports: on`，`just fix` 会自动整理，提交前必须跑。
- **装饰器**: `experimentalDecorators` + `emitDecoratorMetadata` 已启用。
- **日志**: 业务服务、控制器与基础设施使用注入的 `Logger` (Pino)，严禁在业务逻辑中使用 `console.log`（CLI / Seeder 终端输出除外）。
  - **原生极速架构**: 彻底消除 `nestjs-pino` / `pino-http` 额外包装层，基于原生 `@Global()` `LoggerModule` 与 `PinoLoggerService` 实现。
  - **双通道流分离**: 终端控制台通过 `pino-pretty` 彩色高亮；磁盘文件由 `pino-roll` 按日切割并经过 `createFileFilterStream` 剥离冗余 HTTP 访问流，只持久化纯业务/异常日志。
  - **框架噪音过滤**: `SILENT_BOOTSTRAP_CONTEXTS` 自动静默 `InstanceLoader`、`RoutesResolver` 和 `RouterExplorer` 的 `INFO` 级别日常输出，WARN / ERROR 异常无损放行。
- **分层异常处理 (Tiered Exception Handling)**:
  - **Controller 层**: 严禁写任何 `try-catch`，所有错误 100% 冒泡交由全局过滤器。
  - **Service 层 (常规)**: 默认不写 `try-catch` 包裹正常业务，业务校验失败直接直抛标准异常 (`NotFoundException` / `BadRequestException` 等)。
  - **Service 层 (白名单 catch)**: 仅在以下 3 类场景允许使用 `try-catch`：
    1. **资源补偿与回滚**: 如写盘成功但落库失败时，推荐使用 `MediaService.storeWithCompensation` 自动安全接管。
    2. **弱依赖旁路降级**: 如删除旧头像、非核心日志记录，catch 后记录 warn，不阻断主流程。
    3. **领域错误转译**: 捕获专有驱动异常并转译为语义明确的业务异常。
  - **全局过滤器 (`HttpExceptionFilter`)**: 统一响应格式、生产环境 SQL/堆栈脱敏，并自动识别 Postgres 错误码（如 `23505` 唯一键冲突 → 409 Conflict、`23503` 外键无效 → 400 Bad Request）。
- **Swagger / OpenAPI 规范**:
  - **中文极简命名**: 所有 Controller 的 `@ApiTags`（如 `@ApiTags('用户管理')`、`@ApiTags('认证')`）与 `@ApiOperation({ summary })`（如 `@ApiOperation({ summary: '创建用户' })`、`@ApiOperation({ summary: '登录' })`）统一采用纯粹、简明的中文表达，严禁中英混杂或冗长套话。
  - **禁写 `@ApiErrorResponse`**: 全局统一异常过滤器 (`HttpExceptionFilter`) 已经 100% 接管所有错误状态码与统一错误响应信封结构，Controller 层**严禁/无需声明任何 `@ApiErrorResponse`**，以保持控制器注解精简清爽。
- **工具库标准 (es-toolkit 优先规范)**:
  - **唯一首选**: 项目全面拥抱 `es-toolkit` (2~3x 极速、纯 ESM、类型安全)。严禁引入 Lodash / Underscore / Ramda 等老旧或体积庞大的工具库。
  - **按需引入与场景速查表**:

    | 场景领域 | 推荐 API | 典型应用范式 |
    | :--- | :--- | :--- |
    | **对象清洗与 DTO 映射** | `pick`, `omit`, `cloneDeep`, `toMerged` | `pick(entity, ['id', 'name', 'email'])` 抽取 API 返回字段；`omit(row, ['passwordHash'])` 剔除敏感属性；`pick(dto, ['name', 'avatarUrl'])` 提炼更新载荷。 |
    | **集合计算与批处理** | `uniq`, `uniqBy`, `chunk`, `compact`, `groupBy`, `keyBy`, `sortBy`, `orderBy` | `uniq(guardNames)` 替代 `[...new Set(...)]`；`chunk(ids, 500)` 批处理数据库与队列任务；`compact(urls)` 清除空值；`groupBy(logs, 'level')` 统计汇总。 |
    | **异步流控与延时** | `delay`, `retry`, `withTimeout`, `debounce`, `throttle` | `await delay(200)` 恒定时间侧信道防御与定时等待；`await retry(fn, { retries: 3 })` 外部网络与 S3 I/O 容灾重试；`withTimeout` 防挂死。 |
    | **字符串与命名** | `camelCase`, `pascalCase`, `snakeCase`, `kebabCase`, `deburr` | 统一从 `es-toolkit/string` 导入；`deburr(text)` 分解重音字符；`kebabCase(name)` 命名策略。 |
    | **类型守卫与安全计算** | `isNil`, `isEmptyObject`, `isPlainObject`, `clamp` | `isNil(val)` 替代 `val === null \|\| val === undefined`；`clamp(size, 1, 100)` 约束分页与数值边界。 |

### 高性能与高可用基础设施

- **全链路可观测性**: 请求追踪 `x-request-id` 下沉 Fastify Hook，耗时用 `reply.elapsedTime`，覆盖含 401/403/404/429/500 的所有流量。
- **`RedisService`**: `withLock('lock:key', ttlMs, fn)` 分布式排他锁 + `remember` 读写穿透缓存，保证多 Pod 下 Cron 幂等与防击穿。
- **事务性媒体存储**: `storeWithCompensation` 自动处理「写盘 → 落库 → 失败回滚清理 → 成功旧图回收」，支持 Local/S3 双向 URL/Path 映射。
- **CRUD 生成器三层解耦**: `SchemaInspector`（AST 反解）/ `TemplateRenderer`（纯内存变换）/ `ArtifactWriter`（安全写盘 + AdminModule 幂等注册）。

## Git 工作流

- **Lefthook pre-commit** (`lefthook.yml`): 并行跑 biome (含 `--write` 自动修复并 `stage_fixed`)
  - helm lint + `tsc --noEmit`。
- 提交前本地跑 `just check` 可提前发现绝大部分问题。
- `*.log`、`storage/*/` 内容、`.env`、`*.ini` (除 example) 均被 `.gitignore` 忽略；`storage/*/` 通过 `.gitignore` 占位文件保留目录结构。

## Secrets 与部署

- **`.env`**: 本地开发，不入库。
- **`secret.ini`**: 部署用 VPS/SSH 凭据，`scripts/sync-secrets.sh` 同步到 GitHub Secrets (见 `secret.example.ini`)。
- **Docker**: `docker/app/Dockerfile` 多阶段构建 (oven/bun:1.4-alpine)，生产镜像不含源码与 devDeps，`CMD ["bun", "run", "dist/main.js"]`；Docker 运维配置集中收敛于 `docker/`（含 `docker/app/`、`docker/centrifugo/`、`docker/docker-compose.yml`）。

## 易踩坑

1. **新增业务模块只需加入 `FEATURE_MODULES`** — 在 `src/features/index.ts` 中声明即可自动挂入 `AppModule` 与 `CliModule`，保障 CLI 路由发现完整。
2. **新增管理端点必须落 `/admin` 前缀** — 在 `src/features/admin/{users,notifications,dashboard,admins}/` 对应领域子目录内新增/扩展；`AdminPrefixGuard` 已全局强制仅合法管理角色（SUPER_ADMIN / ADMIN / OPERATOR）可访问（登录端点通过 `@Public()` 豁免），业务端点级无需重复标注。前端自助端点（`/users/me` 等）不得迁入 `/admin`，否则普通用户将被守卫拦截。
3. **`MailJobs` 隐式依赖 BullMQ** — 任何间接 import `AuthModule` 的场景都要配 `BullModule.forRootAsync`，否则队列连接报错。
4. **Fastify 5 ≠ Express** — 用 `@nestjs/platform-fastify`，第三方插件/中间件需 Fastify 5 兼容版本；`req`/`reply` 类型不同；响应耗时用 `reply.elapsedTime`（严禁使用已弃用的 `reply.getResponseTime()`）。
5. **纯 ESM 运行时规范** — 项目已声明 `"type": "module"`，严禁直接使用 CJS 全局变量 `__dirname` / `__filename`，统一使用 `import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url))`；SWC 配置需保持 `module.resolveFully: true` 以确保相对导入携带 `.js` 扩展名。
6. **SWC 构建与资源拷贝** — SWC 仅做转译，类型检查用 `tsc --noEmit`；构建时需通过 `tsconfig.build.json` 锁定 `"rootDir": "src"`，防止 Nest CLI 误判项目根目录导致 assets 资源拷贝偏移至 `dist/src/`。
7. **启动日志降噪机制** — 启动时不输出数十行 `InstanceLoader` 与路由映射属于设计内行为（由 `SILENT_BOOTSTRAP_CONTEXTS` 静默）；完整路由树请运行 `just cmd route:list` 查看。
8. **`storage/logs`** 由 `pino-roll` `mkdir: true` 自动创建；
   `storage/uploads` 由业务 `fsPromises.mkdir({recursive:true})` 创建，无需手动建目录。
9. **Vitest 配置两份**: `vitest.config.mts` (unit) / `vitest.e2e.config.mts` (e2e)，别混用。
10. **Controller 禁写 `@ApiErrorResponse` 与中文文档规范** — 错误响应已由 `HttpExceptionFilter` 全局标准化接管，Controller 层无需也不得标注 `@ApiErrorResponse`；所有 Controller 的 `@ApiTags` 与 `@ApiOperation({ summary })` 必须使用纯粹、简明的中文命名。
11. **工具库严禁引入 Lodash** — 项目已全面接入 `es-toolkit`，所有对象清洗、集合计算、批处理、延迟与字符串操作一律使用 `es-toolkit`（如 `pick`, `omit`, `uniq`, `chunk`, `delay`, `deburr`），严禁引入 `lodash` 或 `lodash-es`。

## 代码修改 Checklist

动手前：

- [ ] 读完相关模块的 `*.module.ts` 与 `*.service.ts`，确认依赖链。
- [ ] 涉及 env → 同步改 `env.validation.ts` + `.env.example`。
- [ ] 涉及 schema → 改 `src/database/drizzle/schema/*.schema.ts` → `just db-gen && just db-migrate`。

动手后：

- [ ] `just fix` (格式化 + lint 自动修复)
- [ ] `just type` (类型检查)
- [ ] `just test` (相关单测)
- [ ] 新增/改命令 → `just build && just cmd <cmd>` 验证
- [ ] 改了 `AppModule` 的 controller 模块 → 检查 `CliModule` 是否需要同步

## 代码搜索与修改工作流

遵循「定位 → 结构大纲 → 精准阅读 → 结构化修改 → 验证」。

- **定位**: `rg "pattern" src -C 3` / `fd -e ts "service"` 全文与符号查找。
- **结构透视**: 200+ 行大文件严禁直接全量 read，先用 `just outline <path>`（单文件签名）、`just outline <path> --items exports`（导出契约）、`just outline <path> --type class --match ".*Controller"`（过滤类）获取紧凑结构。
- **架构规则**: `rules/` 维护强约束架构规则（Controller 禁 try-catch、业务禁 console、严禁 Express 等）；`just sg-lint` 扫描、`just sg-test` 运行规则单测。
- **结构化批量重构**: 对 import/装饰器等有语法结构的重复改动，先写规则 `ast-grep run -r <rule-id> --inline <file>` 验证，再 `-U` 全量应用。
- **验证**: 改动前 `rg` 定位所有关联位置防漏改；改动后 `just check`（fix + fmt + type + sg-lint + sg-test）。

## Agent skills

- **Issue tracker**: issues 以 markdown 存于 `.scratch/<feature-slug>/`，见 `docs/agents/issue-tracker.md`。
- **Triage labels**: `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`，见 `docs/agents/triage-labels.md`。
- **Domain docs**: `CONTEXT.md` + `docs/adr/` 单上下文布局，见 `docs/agents/domain.md`。
