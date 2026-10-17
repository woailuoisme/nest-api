# AGENTS.md

本文件为 AI 编码助手提供项目上下文与协作规范，请在动手前完整阅读。

## 项目概览

**NestForge** — 生产级 NestJS 企业后端脚手架。

- 运行时: Bun ≥ 1.2 + Node ≥ 24，纯 ESM（`"type": "module"`）
- 框架: NestJS 12 + Fastify 5（非 Express）· ORM: Drizzle 0.45（PostgreSQL 多文件 schema）· 校验: Zod 4 · Redis + BullMQ
- 构建: SWC（`resolveFully`），类型检查 `tsc --noEmit` · 测试: Vitest 5 · Lint: oxlint · 格式: oxfmt · 任务: Just
- 工具库: es-toolkit（唯一首选，严禁 Lodash）· 日志: 原生 Pino（stdout 单通道，异常经 Sentry 上报）· 可观测: OpenTelemetry（traces/metrics → otel-collector → OpenObserve）

## 常用命令

```bash
just dev          # 开发模式 (单进程内嵌 Worker + watch)
just dev-all      # 开发模式 (双进程并发 + watch)
just start-embedded # 生产模式 (单进程内嵌 Worker)
just build        # 构建到 dist/
just type         # tsc --noEmit 类型检查
just lint         # oxlint 静态检查 (src tests)
just fix          # oxlint --fix + oxfmt (src tests)
just fmt          # oxfmt 格式化
just sg-lint      # ast-grep 架构规则静态检查
just sg-test      # ast-grep 规则单测 (rule-tests)
just outline <path> # 查看文件或目录的紧凑 AST 结构大纲
just check-deprecated # 一键全库扫描已废弃 (@deprecated) 的第三方/原生函数
just secret-check     # gitleaks 密钥与敏感凭据泄漏静态扫描
just check        # fix + fmt + type + secret-check + sg-lint + sg-test + i18n-check (提交前完整检查)
just test         # 单元测试
just test-e2e     # E2E 测试
just test-cov     # 单测 + 覆盖率
just test-watch   # 单测 watch 模式
just k6 smoke     # 运行 k6 smoke 场景负载基准测试

# Drizzle
just db-gen       # 生成迁移 SQL (drizzle-kit generate)
just db-migrate   # 应用迁移 (dev)
just db-deploy    # 应用迁移 (prod)
just db-seed      # 灌种子数据
just db-studio    # Drizzle Studio
just db-reset     # 重置数据库 (destructive)

# Better Auth
just ba-migrate   # 生成并应用 Better Auth 表结构变更
just ba-generate  # 依据 better-auth.ts 重新生成 Drizzle Schema
just ba-info      # 显示系统与 Better Auth 配置信息
just ba-secret    # 生成新的 Better Auth secret

# 容器编排与服务 (Docker / Centrifugo)
just docker-up    # 启动全栈 Docker 容器集群 (API + 附属组件)
just docker-down  # 停止全栈 Docker 容器集群
just realtime     # 启动 Centrifugo 独立实时服务容器
just realtime-health # 检查 Centrifugo 健康状态
just mail-build   # 编译 MJML 邮件模板为 Handlebars (.hbs)
just i18n-gen     # 生成 i18n TypeScript 强类型定义
just i18n-check   # 校验多语言翻译字典键值对称性

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
│   ├── sql/        # 原生 PostgreSQL DDL (00_init.sql, 01_auth.sql, 02_features.sql 供 DBA 审计与独立建表)
│   ├── drizzle.module.ts  # @Global() Drizzle 模块
│   └── drizzle.service.ts # postgres.js + drizzle 客户端
├── search/         # Laravel Scout 风格模型全文索引定义 (index.ts, user.searchable.ts)
└── seeds/          # 种子数据 (admin.seed.ts, user.seed.ts, index.ts)
src/
├── common/         # 全局 Filter/Guard/Interceptor/Pipe/Decorator/DTO/utils
│   ├── constants/  # PATHS、NETWORK、Role、Permission 等常量
│   ├── decorators/ # @Roles() @Permissions() @CurrentUser() 等
│   ├── excel/      # ExcelJS 封装
│   ├── mail/       # 统一邮件服务 (直连 nodemailer + 自持 Handlebars 渲染器 + MJML 模板)
│   ├── media/      # 媒体处理服务 (imgproxy JIT动态实时渲染/纯JS元数据/矢量二维码/命名策略)
│   ├── resilience/ # 熔断 (CircuitBreaker) / 优雅限流 / 过载保护 (LoadShedding) / 超时拦截
│   ├── search/     # Laravel Scout 风格搜索引擎抽象 (Meilisearch / Noop / 队列异步同步)
│   └── storage/    # 本地/S3 驱动 (drivers/local.driver.ts, s3.driver.ts)
├── config/         # env.validation.ts (Zod schema)
├── database/       # drizzle/ + bull.config.ts + redis.module.ts
├── commands/       # nest-commander CLI (route-list, db-seed, jwt-secret, search)
├── i18n/           # nestjs-i18n 配置
├── iot/            # 统一工业物联网与设备通信中枢：MQTT 5.0 传输层 + 声明式订阅 + 遥测影子 + 同步 RPC
│   ├── transports/     # MQTT 5.0 传输层契约与适配服务 (mqtt.service.ts, interfaces, utils)
│   ├── decorators/     # 声明式注解 (@MqttSubscribe, @MqttPayload, @MqttParams, @MqttCtx)
│   ├── explorer/       # MQTT 元数据与拓扑发现服务 (mqtt-explorer.service.ts)
│   ├── services/       # 遥测影子与指令 RPC 服务 (iot-command.service.ts, iot-telemetry.service.ts)
│   ├── dto/            # 统一设备 DTO 与影子实体 (iot.dto.ts)
│   ├── iot.controller.ts # 模拟仿真与设备管理控制器 (/v1/iot/devices/*)
│   ├── iot.module.ts   # @Global() 核心物联网模块 (并提供 MqttModule 兼容别名)
│   └── index.ts        # 聚合导出
├── realtime/       # 统一实时通信中枢 (对齐 Laravel Broadcasting)：Centrifugo 适配 + 频道鉴权 + 协议 Token + 领域事件
│   ├── channels/       # 模式匹配频道鉴权与业务频道定义 (channel-manager.service.ts, @ChannelAuth 等)
│   ├── transports/     # 传输层契约与 Centrifugo 适配器 (centrifugo.transport.ts)
│   ├── dto/            # 统一请求与响应 DTO (realtime.dto.ts)
│   ├── realtime.controller.ts # 多协议路由控制器 (/v1/realtime/*, /v1/websocket/*, /v1/sse/*)
│   ├── realtime-events.service.ts # 领域事件监听与转发服务
│   ├── realtime.service.ts # 统一领域发布服务
│   └── realtime.module.ts # @Global 实时模块
├── features/       # 统一业务特性层 (client: 客户端业务特性 / system: 系统基础设施 / admin: 后台管理自包含领域)
│   ├── client/     # 客户端特性模块 (auth, users)
│   ├── system/     # 系统/基础设施业务模块 (health)
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
│   ├── logger/     # 原生 PinoLoggerService + LoggerModule + 日志流配置
│   └── otel/       # OpenTelemetry NodeSDK 初始化 (traces + metrics → OTLP)
├── app.module.ts   # 主模块
├── cli.module.ts   # CLI 入口模块
├── cli.ts          # CLI bootstrap
└── main.ts         # HTTP bootstrap
deploy/             # 统一交付与运维编排 (Docker 容器编排 app/centrifugo/... + Helm Kubernetes Chart)
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

`@/*` → `./src/*` (tsconfig + vitest + oxlint 均已配置)。优先用别名导入。

### 模块组织

- 业务模块统一按端归入 `src/features/`：
  - 客户端特性放 `src/features/client/<feature>/`，每个模块自带 `*.module.ts`、`*.controller.ts`、`*.service.ts`、`*.dto.ts`。
  - 系统/基础设施端点（如健康检查）放 `src/features/system/<feature>/`。
  - 管理后台领域放 `src/features/admin/<feature>/`，由 `src/features/admin/admin.module.ts` 聚合并强制 `/admin` 前缀与 `AdminPrefixGuard` 准入。
- **Admin / 前端 API 边界**: 后台管理领域（users / notifications / dashboard / admins / auth）的 controller + service + DTO 全部自包含于 `src/features/admin/`，由 `AdminModule` 聚合成唯一管理面入口并纳入 `FEATURE_MODULES`；准入由全局 `AdminPrefixGuard` 默认拒绝式强制（仅限合法管理角色 SUPER_ADMIN / ADMIN / OPERATOR，支持显式 `@Public()` 白名单豁免如 `/admin/auth/login`）。前端自助模块 `src/features/client/users/` 自包含自有 service 与 DTO（仅 `/users/me`、`/users/:id`、头像上传），与 admin 管理面零依赖；`AuthModule` 基于 Drizzle 客户端直接原子落库，与 `AdminUsersModule` 彻底解耦零依赖。**新增管理端点必须落在 `src/features/admin/`，严禁混入前端 controller**；`crud:generate` 产物支持 `--scope=admin|client` 分流，admin 产物自动落入该边界（`src/features/admin/<feature>/`）并自动注册进 `AdminModule`。
- **扁平数据访问**：Service 层直接使用 `@InjectDb() private readonly db: DrizzleDB` 注入数据库客户端，通过 `this.db.query...` / `this.db.insert...` 进行类型安全操作，不设多余的 Repository 样板层。
- **多写原子事务 (Transaction)**：涉及多表关联写入（如创建用户并绑定 OAuth 账户）或多步更新时，使用显式原生闭包 `await this.db.transaction(async (tx) => { ... })` 保证强一致性与自动回滚。
- **全文搜索模型解耦 (Laravel Scout 模式)**：数据表/实体如需支持全文检索，统一在 `src/database/search/` 目录下实现 `Searchable` 契约（如 `user.searchable.ts`）并注册入全局索引映射；业务数据增删改时通过 `SearchSyncService` 发布队列异步同步任务，严禁在业务 Service 中直接硬编码调用底层搜索引擎 SDK（如 Meilisearch 客户端），保障驱动可插拔性（Meilisearch / Noop 空驱动降级）。
- **工业物联网总线解耦 (Decoupled MQTT & Telemetry)**：物联网设备指令交互与遥测采集集中收敛于顶级目录 `src/iot/`。传输层与业务服务一体化内聚，监听统一使用声明式 `@MqttSubscribe(topic, options)` 装饰器；向物理/仿真设备下发控制指令统一调用 `IotCommandService` 或 `MqttService.publish()` / RPC，禁止外部业务逻辑直连外部 MQTT Broker 客户端。
- **上传链路 (Native Multipart Pipeline)**：文件上传统一使用平台原生能力 —— 路由级 `FileInterceptor` / `FilesInterceptor` / `FileStreamInterceptor`（`@nestjs/platform-fastify/multipart`）+ `@nestjs/common` 的 `@UploadedFile/@UploadedFiles` 参数装饰器。大小上限由拦截器 `limits.fileSize` 在流式写入过程中强制（超限即 413）；MIME / 扩展名白名单由 `createUploadFileFilter()` 注入 `fileFilter`（违规 400）。载荷类型 `UploadedFile = MemoryUpload | MultipartFileStream`（`src/common/storage/interfaces/upload.interface.ts`）交由 `MediaService.save()` 落盘。**表单字段名（如头像的 `file`）属对外契约的一部分**（原生拦截器按字段名精确匹配）；**禁止再引入自研的全局 multipart 收集拦截器或第二套解析实现**（历史自研实现因争抢同一条 busboy 流、需自管三层临时文件清理，已在 Nest 12 对齐中删除）。
- **模块可见性 (@Global 政策)**：仅**叶基础设施**（Storage / Excel / Mail / Search / Cache / Logger / Redis / Drizzle / Idempotency / Jobs / Wechat）使用 `@Global()`；**领域模块一律显式 import**（`MediaModule` / `IotModule` / `RealtimeModule` / `ResilienceModule`），保证依赖关系可追溯。新增领域模块时请在使用方 `imports` 中显式声明，不要依赖全局可见性。

### 环境变量

- `src/config/env.validation.ts` 用 Zod 定义所有 env，启动时强制校验。
- **全 URL 统一配置规范**：核心连接统一采用单一 DSN / URL 格式收敛，彻底摒弃散装 HOST/PORT/PASSWORD：
  - **Database**: `DB_URL="postgresql://user:pass@host:5432/dbname?schema=public"`
  - **Redis**: `REDIS_URL="redis://:password@host:6379/0"`（或 `rediss://...`）
  - **Mail**: `MAIL_URL="smtp://user:pass@host:587"`（发件人保持 `MAIL_FROM_ADDRESS` / `MAIL_FROM_NAME`）
  - **S3 Storage**: `STORAGE_S3_URL="s3://key:secret@endpoint:port/bucket?region=...&publicUrl=..."`
  - **Realtime (Centrifugo)**: `REALTIME_URL="centrifugo://api-key:hmac-secret@host:port/api?tls=false"`
  - **Search (Meilisearch)**: `SEARCH_URL="meilisearch://masterKey@localhost:7700"`（未配置时默认使用 `noop` 空驱动降级，配置后推导为 `SEARCH_DRIVER=meilisearch`）
  - **Imgproxy**: `IMGPROXY_URL="imgproxy://key:salt@host:port?publicUrl=..."`（支持 HMAC-SHA256 安全签名与多驱动映射）
  - **MQTT (Mosquitto/EMQX)**: `MQTT_URL="mqtt://admin:password@localhost:1883?clientId=nest-api"`（工业物联网通信与遥测总线）
- **安全相关 env**：
  - `COOKIE_SECRET`（≥32 字符，可选）：配置后启用框架内置 Cookie（`setCookie(..., { signed: true })` / `@SignedCookies()`）；未配置则不启用，不预置弱默认密钥。由主进程在引导期直接读取 `process.env`（早于 ConfigModule 生效）。
  - `TRUSTED_ORIGINS`（逗号分隔，可选）：内置 CSRF 额外信任的浏览器来源（`scheme://host[:port]`）。同源请求与 http(s) 服务端调用无需配置；独立域名前端需显式列出，`APP_URL` / `BETTER_AUTH_URL` / `PASSKEY_ORIGIN` 会自动纳入信任列表。
- 新增 env 必须**同步更新** validation schema 与 `.env.example`。
- `.env` 由 `dotenv/config` 在 `drizzle.config.ts` 与 CLI 入口加载。
- 校验通道：`ConfigModule.forRoot({ validationSchema: envSchema })`（Nest 12 原生 Standard Schema），Zod schema 即契约，失败信息按 `字段: 文案` 逐行输出。

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

### 安全基线 (Nest 12 内置能力)

- **安全响应头**: `app.useSecurityHeaders({ contentSecurityPolicy: false })` —— 默认值与 helmet 8 等价（CSP 保持关闭以兼容 Scalar / Bull Board / 日志面板的内联脚本），已移除 `@fastify/helmet` 依赖。
- **跨站请求防护 (CSRF)**: `app.enableCsrfProtection()` 基于 Fetch Metadata（`Sec-Fetch-Site` + Origin/Host 回退），**非令牌方案** —— 无 `Origin` / `Sec-Fetch-Site` 的服务端调用天然放行；跨域浏览器写请求需在 `TRUSTED_ORIGINS` 声明来源，第三方回调（微信支付 `*/payments/wepay/notify`）已在 `exclude` 中豁免。CORS 仍保持开放（`enableCors()`），由 CSRF 承担写请求的跨站防护。
- **内置 Cookie**: 仅在配置 `COOKIE_SECRET` 时启用（`setCookie` / `@SignedCookies()`）。
- **路由冲突诊断**: `routeConflictPolicy: { duplicate: 'error', shadow: 'warn' }` 在适配器注册前拦截重复路由（`method+path+version` 完全一致）；Fastify 为顺序不敏感适配器，框架只在该类适配器上应用 `duplicate` 策略，故 `shadow` 与 `routeResolutionStrategy` 对 Fastify 不生效（radix 路由天然静态段优先）。

### HTTP 边界能力（压缩与限流）

- **响应压缩**: `@fastify/compress` 在 `registerFastifyPlugins` 中注册，**必须先于 `@fastify/static`**（插件 README 硬性要求，否则静态资源不参与协商）。不显式传 `encodings`：默认即为服务端支持全集（br / gzip / deflate，Node 支持 zstd 时含 zstd），显式列表只会收窄协商范围。阈值由 `COMPRESSION_THRESHOLD_BYTES` 控制（默认 1024 字节，流式响应对该阈值不适用）。以下一律不压缩：`text/event-stream`（插件默认可压缩类型正则已排除 event-stream）、分片响应（206 / `Content-Range`）、已带 `Content-Encoding` 的响应、已压缩二进制（webp / png / jpeg / mp4 / xlsx）。**已知取舍**：`application/octet-stream`（未知扩展名文件）在插件默认正则与 mime-db 中均被标为可压缩，且 `customTypes` 只能放宽不能收紧（mime-db 为兜底判定会重新放行），按路由 `compress: false` 对 `@fastify/static` 亦不可用 —— 故接受此项（仅 CPU 浪费，无正确性问题），如需收紧请在网关侧统一压缩策略。客户端可用 `x-no-compression` 请求头临时关闭；`COMPRESSION_ENABLED=false` 时整段跳过注册。
- **限流计数跨副本一致**: `ThrottlerModule` 必须以**对象形态**配置（数组形态会强制回落到进程内存储，多副本下限流额度被放大 N 倍）。`THROTTLE_STORAGE=redis`（默认）时由 `RedisThrottlerStorage`（`src/common/throttler/`）以单条 Lua 在 Redis 侧原子完成计数与封禁判定，键空间 `throttle:{throttlerName}:{key}`（`key` 为 @nestjs/throttler 默认 generateKey 的 SHA-256 摘要：class + handler + 名称 + 客户端标识，无明文个人信息；仍不在日志中输出）。本地无 Redis 时设 `THROTTLE_STORAGE=memory`（仅进程内计数）。
- **限流降级的两层要求（缺一不可）**: ① 语义层 —— Redis 不可用时回退进程内计数并限频告警，限流基础设施抖动不得演化为 5xx；② 时间层 —— 客户端 `status` 非 `ready`（`'wait'` 除外，那是 `lazyConnect` 冷启动，必须放行否则永不建连）时立即降级，就绪时对单次调用加 `THROTTLE_REDIS_TIMEOUT_MS`（100ms）时间上界。**守卫阶段不受 `HTTP_TIMEOUT_MS` 约束**（Nest 生命周期为 middleware → guards → interceptors），故请求热路径上的依赖调用必须自带上界：ioredis 默认 `enableOfflineQueue: true`，断连期间的命令会排进离线队列等完整个重连周期（实测单次 >7s、连续请求可达 20s）。
- **Redis Lua 脚本唯一事实源**: 全部脚本集中在 `src/database/lua-scripts.ts`，**禁止在调用处内联复制脚本文本**（历史上解锁脚本曾被复制两份）。加载策略按调用频率区分：请求热路径用 `defineCommand`（EVALSHA 优先 + NOSCRIPT 回落，避免重传脚本体），低频临界区脚本直接 `eval`。
- **邮件栈自持**: 已移除 `@nestjs-modules/mailer`（其 `MailerOptions.defaults` 类型与 nodemailer 10 不同步，且带来 `@css-inline/css-inline` 原生二进制等传递依赖）。传输层由 `mailTransporterProvider` 以 nodemailer 原生两参形态创建（`createTransport(MAIL_URL, { from })`），模板渲染由 `MailTemplateRenderer` 以 Handlebars `strict: true` 完成并按文件名缓存，应用关闭时 `MailTransporterLifecycle` 调用 `transporter.close()` 释放连接池。仅依赖 `ConfigModule` + 文件系统，可在无 HTTP 运行期的 Worker 进程中直接导入。

### CLI 模块 (`src/cli.module.ts`)

独立于 `AppModule` 且免除 HTTP 守卫与 Worker 额外开销。所有带 Controller 的业务模块统一在 `src/features/index.ts` 中的 `FEATURE_MODULES` 集中声明，`AppModule` 与 `CliModule` 统一展开引入，彻底消除路由发现缺失与模块漂移。
BullMQ 队列由 `AuthModule → MailJobs` 依赖，CLI 模块也需 `BullModule.forRootAsync(...)`。

## 编码规范

- **格式**: oxfmt 强制 single quote / semicolon / 2-space / 120 列 / LF / all trailing comma（`.oxfmtrc.json`）。
- **import 排序**: oxfmt `sortImports: true`，`just fix` 会自动整理，提交前必须跑。
- **Lint**: oxlint（`.oxlintrc.json`，correctness 类目 + 手选规则；测试文件与 CLI/seeds 豁免见 overrides）。
- **装饰器**: `experimentalDecorators` + `emitDecoratorMetadata` 已启用。
- **校验与输出契约 (Nest 12 原生 Standard Schema)**：
  - 请求校验走框架原生通道：路由参数装饰器携带 `schema`（`@Body({ schema: CreateUserSchema })` / `@Query({ schema: FindUsersSchema })` / `@Param(name, { schema })`），由全局 `StandardSchemaValidationPipe` 执行；失败统一 422 + `{ code: 'VALIDATION_FAILED', message, fields, errors }` 信封（`createApiValidationPipe()`，`src/setup/middleware.ts`）。
  - DTO 一律「`XxxSchema` 常量 + `export type XxxRequest = z.infer<typeof XxxSchema>`」形式；**不再使用 `nestjs-zod` / `createZodDto`**（依赖已移除）。
  - 响应输出用 `@SerializeOptions({ schema })` + 全局 `StandardSchemaSerializerInterceptor`，按 schema 做**白名单裁剪**（资源 schema 同时是 OpenAPI 响应文档的单一事实源）；分页信封用 `paginatedEnvelopeSchema(itemSchema)` / `cursorPaginatedEnvelopeSchema(itemSchema)` 工厂。
  - OpenAPI 转换由 `standardSchemaConverter`（`src/setup/swagger/standard-schema-converter.ts`）接管 Zod schema，`z.date()` 等不可表达类型统一映射为 `string/date-time`。
  - `@ApiSuccessResponse` / `@ApiPageResponse` / `@ApiCursorPageResponse` 同时接受**实体类**与 **Zod schema** 两种模型。
  - 路径参数：非 schema 场景沿用内置管道（`ParseUUIDPipe` 等）；领域标识用显式 schema（如 IoT 的 `DeviceIdSchema`），不要假设 UUID。
- **日志**: 业务服务、控制器与基础设施使用注入的 `Logger` (Pino)，严禁在业务逻辑中使用 `console.log`（CLI / Seeder 终端输出除外）。
  - **原生极速架构**: 彻底消除 `nestjs-pino` / `pino-http` 额外包装层，基于原生 `@Global()` `LoggerModule` 与 `PinoLoggerService` 实现。
  - **单通道 stdout**: 生产输出单行 JSON（带 `service`/`hostname` 基字段与 ISO 时间，便于多进程 / 多副本归集），开发 / 测试输出 `pino-pretty` 彩色单行。**不落盘**：日志留存交容器日志驱动（`deploy/app/docker-compose.yml` 的 `json-file` 上限，分离 `worker` 拓扑需复用同一 `logging` 块），异常另经 `sentryHooks`（level ≥ 50）上报 Sentry / GlitchTip；Pino `mixin` 注入 `trace_id`/`span_id`（无活动 span 零开销），otel-collector `filelog` 采集容器 stdout 后三信号在 OpenObserve 内互相关联。
  - **依赖形态约束**: `pino-pretty` 属 devDependencies（生产镜像 `bun install --production` 不含它），故**必须动态导入**（`await import('pino-pretty')`）；任何对 devDependency 的静态导入都会让生产进程启动即崩，`tests/unit/setup/logger.config.test.ts` 已加回归锁。
  - **框架噪音过滤**: `SILENT_BOOTSTRAP_CONTEXTS` 自动静默 `InstanceLoader`、`RoutesResolver`、`RouterExplorer` 和 `NestApplication` 的 `INFO` 级别日常输出，WARN / ERROR 异常无损放行。
  - **APM 选型**: 不接入 `@nestjs/observe`（供应商型 APM agent，需外部凭证与 SaaS 采集端），走标准 OpenTelemetry 自托管链路：`src/setup/otel/telemetry.ts`（副作用模块，main/worker 先导）按官方标准 env（`OTEL_EXPORTER_OTLP_ENDPOINT` 等）初始化 NodeSDK，traces + metrics 经 OTLP/HTTP+protobuf 推 otel-collector；**未配置 endpoint 时零初始化**（动态 import 均不执行）。纯 ESM 约束：require-hook 类探针（ioredis/pg）不生效，HTTP server spans 由 `@fastify/otel`（diagnostics-channel，`registerOnInitialization: true` 自动挂接全部 Fastify 实例）承担，出站 fetch 由 undici 探针承担；`@sentry/node` 在 OTel 启用时以 `skipOpenTelemetrySetup: true` 让渡 TracerProvider 只做错误告警。优雅关停经 `shutdownTelemetry()` flush。
- **分层异常处理 (Tiered Exception Handling)**:
  - **Controller 层**: 严禁写任何 `try-catch`，所有错误 100% 冒泡交由全局过滤器。
  - **Service 层 (常规)**: 默认不写 `try-catch` 包裹正常业务，业务校验失败直接直抛标准异常 (`NotFoundException` / `BadRequestException` 等)。
  - **Service 层 (白名单 catch)**: 仅在以下 3 类场景允许使用 `try-catch`：
    1. **资源补偿与回滚**: 如写盘成功但落库失败时，推荐使用 `MediaService.storeWithCompensation` 自动安全接管。
    2. **弱依赖旁路降级**: 如删除旧头像、非核心日志记录，catch 后记录 warn，不阻断主流程。
    3. **领域错误转译**: 捕获专有驱动异常并转译为语义明确的业务异常。
  - **守卫层**: 仅「凭证无效 / 账号封禁」映射 401；认证后端自身故障（网络超时、Better Auth 内部异常）必须记 error 日志并以 **503** 上抛，严禁把系统故障伪装成「会话过期」（见 `BetterAuthGuard`）。
  - **全局过滤器 (`HttpExceptionFilter`)**: 统一响应格式、生产环境 SQL/堆栈脱敏，自动识别 Postgres 错误码（如 `23505` 唯一键冲突 → 409 Conflict、`23503` 外键无效 → 400 Bad Request），并优先采用 `HttpExceptionOptions.errorCode` 作为机器可读错误码（其次响应体 `code`，最后状态枚举名）。
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

- **全链路可观测性**: 请求追踪 `x-request-id` 下沉 Fastify Hook，耗时用 `reply.elapsedTime`，覆盖含 401/403/404/429/500 的所有流量；三信号（logs/metrics/traces）经 `deploy/otelcol/` 统一出口推送外部 OpenObserve（`OO_ENDPOINT` / `OO_AUTH` 见 `deploy/.env.example`）。
- **`RedisService`**: `withLock('lock:key', ttlMs, fn)` 分布式排他锁 + `remember` 读写穿透缓存，保证多 Pod 下 Cron 幂等与防击穿。
- **事务性媒体存储**: `storeWithCompensation` 自动处理「写盘 → 落库 → 失败回滚清理 → 成功旧图回收」，支持 Local/S3 双向 URL/Path 映射。
- **CRUD 生成器三层解耦**: `SchemaInspector`（AST 反解）/ `TemplateRenderer`（纯内存变换）/ `ArtifactWriter`（安全写盘 + AdminModule 幂等注册）。

## Git 工作流

- **Lefthook pre-commit** (`lefthook.yml`): 并行跑 oxlint (`--fix`) + oxfmt (均 `stage_fixed`)
  - helm lint + `tsc --noEmit`。
- 提交前本地跑 `just check` 可提前发现绝大部分问题。
- `*.log`、`storage/*/` 内容、`.env`、`*.ini` (除 example) 均被 `.gitignore` 忽略；`storage/*/` 通过 `.gitignore` 占位文件保留目录结构。

## Secrets 与部署

- **`.env`**: 本地开发，不入库。
- **`secret.ini`**: 部署用 VPS/SSH 凭据，`scripts/sync-secrets.sh` 同步到 GitHub Secrets (见 `secret.example.ini`)。
- **Docker**: `deploy/app/Dockerfile` 多阶段构建 (oven/bun:1.4-alpine)，生产镜像不含源码与 devDeps（**故运行时代码不得静态导入 devDependency**），`CMD ["bun", "run", "dist/main.js"]`；交付编排配置集中收敛于 `deploy/`（`deploy/docker-compose.yml` 以 `include:` 汇入 `app/`、`centrifugo/`、`imgproxy/`、`meilisearch/`、`mosquitto/`）。

## 易踩坑

1. **新增业务模块只需加入 `FEATURE_MODULES`** — 在 `src/features/index.ts` 中声明即可自动挂入 `AppModule` 与 `CliModule`，保障 CLI 路由发现完整。
2. **新增管理端点必须落 `/admin` 前缀** — 在 `src/features/admin/{users,notifications,dashboard,admins}/` 对应领域子目录内新增/扩展；`AdminPrefixGuard` 已全局强制仅合法管理角色（SUPER_ADMIN / ADMIN / OPERATOR）可访问（登录端点通过 `@Public()` 豁免），业务端点级无需重复标注。前端自助端点（`/users/me` 等）不得迁入 `/admin`，否则普通用户将被守卫拦截。
3. **`MailJobs` 隐式依赖 BullMQ** — 任何间接 import `AuthModule` 的场景都要配 `BullModule.forRootAsync`，否则队列连接报错。
4. **Fastify 5 ≠ Express** — 用 `@nestjs/platform-fastify`，第三方插件/中间件需 Fastify 5 兼容版本；`req`/`reply` 类型不同；响应耗时用 `reply.elapsedTime`（严禁使用已弃用的 `reply.getResponseTime()`）。
5. **纯 ESM 运行时规范** — 项目已声明 `"type": "module"`，严禁直接使用 CJS 全局变量 `__dirname` / `__filename`，统一使用 `import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url))`；SWC 配置需保持 `module.resolveFully: true` 以确保相对导入携带 `.js` 扩展名。
6. **SWC 构建与资源拷贝** — SWC 仅做转译，类型检查用 `tsc --noEmit`；构建时需通过 `tsconfig.build.json` 锁定 `"rootDir": "src"`，防止 Nest CLI 误判项目根目录导致 assets 资源拷贝偏移至 `dist/src/`。
7. **启动日志降噪机制** — 启动时不输出数十行 `InstanceLoader` 与路由映射属于设计内行为（由 `SILENT_BOOTSTRAP_CONTEXTS` 静默）；完整路由树请运行 `just cmd route:list` 查看。
8. **`storage/uploads`** 由业务 `fsPromises.mkdir({recursive:true})` 创建，无需手动建目录；`storage/logs` 不再承载应用日志（仅 k6 报告归档使用）。
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
