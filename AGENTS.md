# AGENTS.md

本文件为 AI 编码助手提供项目上下文与协作规范，请在动手前完整阅读。

## 项目概览

生产级 NestJS 企业后端脚手架。

- 运行时: Bun ≥ 1.2 + Node ^24.15 或 ≥26（Nest CLI v12 生成器下限），纯 ESM（`"type": "module"`）
- 框架: NestJS 12 + Fastify 5（非 Express）· ORM: Drizzle 1.0 RC（官方 `@nestjs/drizzle` + node-postgres）· 校验: Zod 4 · Redis + BullMQ · TypeScript 6
- 构建: SWC（`resolveFully`），类型检查 `tsc --noEmit` · 测试: Vitest 5 · Lint: oxlint · 格式: oxfmt · 任务: Just
- 工具库: es-toolkit（唯一首选，严禁 Lodash）· 日志: 原生 Pino（stdout 单通道）· 可观测: OpenTelemetry（traces/metrics → otel-collector → OpenObserve）

## 常用命令

```bash
just dev          # 开发模式 (API + Worker 双进程 + watch)
just build        # 构建到 dist/
just serve        # 生产构建 HTTP API (CLI 前门: serve，容器默认 CMD)
just worker       # 生产构建队列 Worker (CLI 前门: worker)
just type         # tsc --noEmit 类型检查
just lint         # oxlint 静态检查 (src tests)
just fix          # oxlint --fix + oxfmt (src tests)
just fmt          # oxfmt 格式化
just secret       # gitleaks 密钥与敏感凭据泄漏扫描
just check        # 提交前完整检查 (fix + type + secret + i18n)
just test         # 单元测试
just watch        # 单测 watch 模式
just cov          # 单测覆盖率
just e2e          # E2E 测试

# Drizzle
just gen          # 生成迁移 SQL (drizzle-kit generate)
just migrate      # 应用数据库迁移
just seed         # 清空所有表数据 + 灌种子 (保留表结构)
just fresh        # 删表重建 + 重跑迁移 + 灌种子 (破坏性)
just studio       # Drizzle Studio 可视化管理

# 工具与多语言
just mail         # 编译 MJML 邮件模板为 Handlebars (.hbs)
just i18n         # 校验 zh/en catalog 键、占位符与复数形式对称性

# CLI (nest-commander)
just cmd --help           # 查看所有命令 (直接跑 TS 源码)
just cmd route:list       # 列出所有路由
just cmd jwt:secret       # 生成 JWT 密钥
just cmd app:init         # 幂等初始化：密钥 / 数据库迁移 / S3 桶（容器内跳过密钥写入，由部署环境注入）
```

运行 TS CLI：`just cmd <command>`。

## 目录结构

```text
src/database/
├── drizzle/        # Drizzle 表定义 + 数据库服务
│   ├── schema/     # 多文件 schema (auth.schema.ts / authentication.schema.ts / notifications.schema.ts 等)
│   ├── sql/        # 原生 PostgreSQL DDL (00_init.sql, 01_auth.sql, 02_features.sql 供 DBA 审计与独立建表)
│   ├── database.ts # Database / Transaction 类型 + createDatabase 工厂
│   ├── pg.ts       # pg 连接池工厂（主库 / 认证池 / seeds 共用）
│   ├── relations.ts # defineRelations 统一关系声明
│   └── drizzle.module.ts  # 薄包装 DrizzleModule.forRootAsync 装配
├── search/         # Laravel Scout 风格模型全文索引定义 (index.ts, user.searchable.ts)
└── seeds/          # 种子数据 (auth.seed.ts, notifications.seed.ts, index.ts)
src/
├── common/         # 全局 Filter/Guard/Interceptor/Pipe/Decorator/DTO/utils
│   ├── constants/  # PATHS、NETWORK、Role 等常量
│   ├── decorators/ # @Public() @CurrentUser() 等
│   ├── mail/       # 官方 @nestjs/mail 邮件栈（Mailable + Handlebars 引擎 + MJML 模板）
│   ├── media/      # 媒体处理服务 (imgproxy JIT动态实时渲染/纯JS元数据/矢量二维码/命名策略)
│   ├── search/     # Laravel Scout 风格搜索引擎抽象 (Meilisearch / Noop / 队列异步同步)
│   └── storage/    # 本地/S3 驱动 (drivers/local.driver.ts, s3.driver.ts)
├── config/         # env.validation.ts (Zod schema)
├── database/       # drizzle/ + bull.config.ts + redis.module.ts
├── commands/       # nest-commander CLI (route-list, db-seed, jwt-secret, search)
├── i18n/           # 官方 @nestjs/i18n 配置 + 命名空间 catalog (translations/{zh,en}/*.json)
├── iot/            # 统一工业物联网与设备通信中枢：MQTT 5.0 传输层 + 声明式订阅 + 遥测影子 + 同步 RPC
│   ├── transports/     # MQTT 5.0 传输层契约与适配服务 (mqtt.service.ts, interfaces, utils)
│   ├── decorators/     # 声明式注解 (@MqttSubscribe, @MqttPayload, @MqttParams, @MqttCtx)
│   ├── explorer/       # MQTT 元数据与拓扑发现服务 (mqtt-explorer.service.ts)
│   ├── services/       # 遥测影子与指令 RPC 服务 (iot-command.service.ts, iot-telemetry.service.ts)
│   ├── dto/            # 统一设备 DTO 与影子实体 (iot.dto.ts)
│   ├── iot.controller.ts # 模拟仿真与设备管理控制器 (/v1/iot/devices/*)
│   ├── iot.module.ts   # 核心物联网模块 (MQTT 5.0 传输/订阅/物模型)
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
│   ├── mail/           # 邮件队列生产者与消费者 (mail.jobs.ts, mail.processor.ts)
│   ├── search/         # 搜索同步队列 (search.jobs.ts, search.processor.ts)
│   ├── token-cleanup/  # Token 清理队列
│   └── jobs.module.ts  # @Global 生产者侧（registerQueue + Jobs）
├── schedules/      # 调度声明 (对齐 Laravel routes/console.php)：集中注册定时任务
│   ├── schedules.module.ts # 聚合所有 *Schedule
│   └── *.schedule.ts      # 每个定时任务一个文件，挂入 SchedulesModule
├── bootstrap/      # 进程引导体 (server.ts / worker.ts)，仅由 CLI 命令调用
├── workers/        # Worker 模块 (worker.module.ts)：只消费队列
├── setup/          # Fastify 插件、中间件、Swagger/Scalar UI
│   ├── logger/     # 原生 PinoLoggerService + LoggerModule + 日志流配置
│   └── otel/       # OpenTelemetry NodeSDK 初始化 (traces + metrics → OTLP)
├── app.module.ts   # 主模块
├── cli.module.ts   # CLI 入口模块
└── cli.ts          # 唯一启动前门 (serve / worker / 一次性命令)
deploy/             # 统一交付与运维编排 (Docker 容器编排 app/centrifugo/... + Helm Kubernetes Chart)
storage/            # 运行时数据 (cache/tmp/uploads，git 忽略内容)
tests/
├── setup.ts            # 全局 setup（环境变量、mock 重置）
├── factories/          # 可复用的测试数据工厂
│   ├── user.factory.ts
│   └── token.factory.ts
├── mocks/              # 共享 Drizzle/Manager mock 工厂
│   └── drizzle.mock.ts
├── unit/               # 单元测试 (*.test.ts)
└── e2e/                # E2E 测试 (*.e2e-test.ts)
```

## 关键约定

### 路径别名

`@/*` → `./src/*` (tsconfig + vitest + oxlint 均已配置)。优先用别名导入。

### 模块组织

- 业务模块统一按端归入 `src/features/`：
  - 客户端特性放 `src/features/client/<feature>/`，每个模块自带 `*.module.ts`、`*.controller.ts`、`*.service.ts`、`*.dto.ts`。
  - 系统/基础设施端点（如健康检查）放 `src/features/system/<feature>/`。
  - 管理后台领域放 `src/features/admin/<feature>/`，由 `src/features/admin/admin.module.ts` 聚合并强制 `/admin` 前缀与 `AdminPolicy` 能力准入。
- **Admin / 前端 API 边界**: 后台管理领域（users / notifications / dashboard / admins / auth）的 controller + service + DTO 全部自包含于 `src/features/admin/`，由 `AdminModule` 聚合成唯一管理面入口并纳入 `FEATURE_MODULES`；准入由 `AdminPolicy` 默认拒绝式强制（SUPER_ADMIN 直通，ADMIN / OPERATOR 按能力细分，`@Public()` 显式豁免）；用户创建/改角色/删除与邮箱变更均为 rank-aware（不得操作同级或更高角色，邮箱变更仅 ADMIN+ 且严格低于目标角色）。前端自助模块 `src/features/client/users/` 自包含自有 service 与 DTO（仅 `/users/me`、`/users/:id`、头像上传），与 admin 管理面零依赖；`AuthModule` 基于 Drizzle 客户端直接原子落库，与 `AdminUsersModule` 彻底解耦零依赖。**新增管理端点必须落在 `src/features/admin/`，严禁混入前端 controller**；`crud:generate` 产物支持 `--scope=admin|client` 分流，admin 产物自动落入该边界（`src/features/admin/<feature>/`）并自动注册进 `AdminModule`。
- **扁平数据访问**：Service 层直接使用 `@InjectDrizzle() private readonly db: Database` 注入数据库客户端（`Database` 类型来自 `src/database/drizzle/database.ts`），通过 `this.db.query...` / `this.db.insert...` 进行类型安全操作，不设多余的 Repository 样板层。官方 `DrizzleModule` 全局注册，无需在各模块 import。
- **多写原子事务 (Transaction)**：涉及多表关联写入（如创建用户并绑定 OAuth 账户）或多步更新时，使用显式原生闭包 `await this.db.transaction(async (tx) => { ... })` 保证强一致性与自动回滚。
- **全文搜索模型解耦 (Laravel Scout 模式)**：数据表/实体如需支持全文检索，统一在 `src/database/search/` 目录下实现 `Searchable` 契约（如 `user.searchable.ts`）并注册入全局索引映射；业务数据增删改时通过 `SearchSyncService` 发布队列异步同步任务，严禁在业务 Service 中直接硬编码调用底层搜索引擎 SDK（如 Meilisearch 客户端），保障驱动可插拔性（Meilisearch / Noop 空驱动降级）。
- **工业物联网总线解耦 (Decoupled MQTT & Telemetry)**：物联网设备指令交互与遥测采集集中收敛于顶级目录 `src/iot/`。传输层与业务服务一体化内聚，监听统一使用声明式 `@MqttSubscribe(topic, options)` 装饰器；向物理/仿真设备下发控制指令统一调用 `IotCommandService` 或 `MqttService.publish()` / RPC，禁止外部业务逻辑直连外部 MQTT Broker 客户端。
- **上传链路 (Native Multipart Pipeline)**：文件上传统一使用平台原生能力 —— 路由级 `FileInterceptor` / `FilesInterceptor` / `FileStreamInterceptor`（`@nestjs/platform-fastify/multipart`）+ `@nestjs/common` 的 `@UploadedFile/@UploadedFiles` 参数装饰器。大小上限由拦截器 `limits.fileSize` 在流式写入过程中强制（超限即 413）；MIME / 扩展名白名单由 `createUploadFileFilter()` 注入 `fileFilter`（违规 400）。载荷类型 `UploadedFile = MemoryUpload | MultipartFileStream`（`src/common/storage/interfaces/upload.interface.ts`）交由 `MediaService.save()` 落盘。**表单字段名（如头像的 `file`）属对外契约的一部分**（原生拦截器按字段名精确匹配）；**禁止再引入自研的全局 multipart 收集拦截器或第二套解析实现**（历史自研实现因争抢同一条 busboy 流、需自管三层临时文件清理，已在 Nest 12 对齐中删除）。
- **模块可见性 (@Global 政策)**：仅**叶基础设施**（Storage / Mail / Search / Cache / Logger / Redis / Drizzle / Idempotency / Jobs / Wechat）使用 `@Global()`；**领域模块一律显式 import**（`MediaModule` / `IotModule` / `RealtimeModule`），保证依赖关系可追溯。新增领域模块时请在使用方 `imports` 中显式声明，不要依赖全局可见性。
- **OTP 发送窗口**：`otp_send_windows`（PK `target+purpose`）独立记录窗口内发送次数，用单条 `INSERT ... ON CONFLICT DO UPDATE ... WHERE` 原子完成「冷却/上限校验 + 自增」，被拒请求不消耗配额；验证码摘要密钥优先取 `OTP_HMAC_KEY`（生产必填），缺失时以 `JWT_SECRET` 域分离派生。
- **DDL 基线守卫**：`src/database/drizzle/sql/` 与 schema 的一致性由 `tests/unit/database/sql-ddl.test.ts` 校验（表 / 列 / 索引名逐项比对），改 schema 后必须同步该目录，否则单测失败。
- **幂等实现口径**：存储为 `idempotency_keys`（`response` 用 `json` 而非 `jsonb`，避免 `\u0000` 写入失败）；错误码与官方对齐（`IDEMPOTENCY_KEY_INVALID` / `IDEMPOTENCY_KEY_IN_USE` / `IDEMPOTENCY_KEY_REUSED`），409 携带 `Retry-After`；回放头 `Idempotent-Replayed` 已通过 CORS `exposedHeaders` 暴露；响应加密通过 `IDEMPOTENCY_KEYS`（逗号分隔、最新在前）开启，未配置则明文。指纹包含 `METHOD` 与路径，改动指纹格式后需先清空 `idempotency_keys`，否则旧记录会被判为 422。

### 环境变量

- `src/config/env.validation.ts` 用 Zod 定义所有 env，启动时强制校验。
- **全 URL 统一配置规范**：核心连接统一采用单一 DSN / URL 格式收敛，彻底摒弃散装 HOST/PORT/PASSWORD：
  - **Database**: `DB_URL="postgresql://user:pass@host:5432/dbname?schema=public"`；连接池由 `DB_POOL_MAX`（默认 10）、`DB_POOL_IDLE_TIMEOUT_MS`（30000）、`DB_POOL_CONNECT_TIMEOUT_MS`（5000）控制
  - **Redis**: `REDIS_URL="redis://:password@host:6379/0"`（或 `rediss://...`）
  - **Mail**: `MAIL_TRANSPORT=smtp|file|resend`（默认 smtp；测试环境自动 file），SMTP 连接 `MAIL_URL="smtp://user:pass@host:587"`，`file` 输出目录 `MAIL_DIRECTORY`，`resend` 需 `RESEND_API_KEY`；发件人保持 `MAIL_FROM_ADDRESS` / `MAIL_FROM_NAME`
  - **S3 Storage**: `STORAGE_S3_URL="s3://key:secret@endpoint:port/bucket?region=...&publicUrl=..."`
  - **Realtime (Centrifugo)**: `REALTIME_URL="centrifugo://api-key:hmac-secret@host:port/api?tls=false"`
  - **Search (Meilisearch)**: `SEARCH_URL="meilisearch://masterKey@localhost:7700"`（未配置时默认使用 `noop` 空驱动降级，配置后推导为 `SCOUT_DRIVER=meilisearch`）
  - **Imgproxy**: `IMGPROXY_URL="imgproxy://key:salt@host:port?publicUrl=..."`（支持 HMAC-SHA256 安全签名与多驱动映射）
  - **MQTT (Mosquitto/EMQX)**: `MQTT_URL="mqtt://admin:password@localhost:1883?clientId=nest-api"`（工业物联网通信与遥测总线）
- **安全相关 env**：
  - `COOKIE_SECRET`（≥32 字符，可选）：配置后启用框架内置 Cookie（`setCookie(..., { signed: true })` / `@SignedCookies()`）；未配置则不启用，不预置弱默认密钥。由主进程在引导期直接读取 `process.env`（早于 ConfigModule 生效）。
  - `TRUSTED_ORIGINS`（逗号分隔，可选）：内置 CSRF 额外信任的浏览器来源（`scheme://host[:port]`）。同源请求与 http(s) 服务端调用无需配置；独立域名前端需显式列出，`APP_URL` 会自动纳入信任列表。
  - `JWT_SECRET`（≥32 字符，生产必填）：官方认证模块 access token 的 HS256 签名密钥；`MFA_ENCRYPTION_KEYS`（逗号分隔，每段 ≥32 字符，生产必填）：TOTP secret 的 AES-256-GCM 加密密钥。
- 新增 env 必须**同步更新** validation schema 与 `.env.example`。
- `.env` 由 `dotenv/config` 在 `drizzle.config.ts` 与 CLI 入口加载。
- 校验通道：`ConfigModule.forRoot({ validationSchema: envSchema })`（Nest 12 原生 Standard Schema），Zod schema 即契约，失败信息按 `字段: 文案` 逐行输出。

### Drizzle 多文件 Schema

- schema 文件放 `src/database/drizzle/schema/*.schema.ts`，由 `drizzle.config.ts` 聚合 (`schema: './src/database/drizzle/schema/*.schema.ts'`)。
- 表定义用 `pgTable()`，跨文件直接 import；`schema/index.ts` 统一 re-export。关系统一在 `src/database/drizzle/relations.ts` 用 `defineRelations(schema, ...)` 声明（v1 不再使用旧版 `relations()`），并传给 `createDatabase()`，`db.query.*` 的类型由 relations 决定。
- `src/database/drizzle/sql/` 提供与 Schema 严格对齐的纯净 PostgreSQL DDL (`00_init.sql`, `01_auth.sql` 等按 00~99 命名)，供快速建库、容器初始化与 DBA 审计。
- 修改 schema 后：`just db-gen` (生成迁移 SQL) → 检查生成的 SQL → `just db-migrate` → 迁移文件提交到仓库。
- **迁移基线**：历史迁移已清除，仓库只保留单一初始迁移 `drizzle/migrations/20261029050219_init`。已有库需重置（本地 `just db-fresh`；生产先备份后 DROP 全部业务表再 `just db-migrate`），否则会在已存在的表上重复建表。

### 鉴权

- **认证 (`@nestjs/authentication`)**：官方模块负责会话 Cookie（`__Host-sid`）、密码（scrypt）、JWT access + refresh、TOTP 两步验证、邮箱验证与找回密码。端点位于 `src/features/client/auth/`：`sign-up` / `sign-in` / `token` / `mfa/*` / `sessions` / `email/*` / `password/*`；`AuthenticationModule` 全局注册，守卫由 `AppModule` 以 `APP_GUARD` 显式排首位（确保 `request.user` 先于管理前缀/权限守卫）。
- **状态存储**：`src/common/auth/authentication.store.ts` 实现官方四契约（sessions / refreshTokens / mfa / emailTokens），落 `sessions` / `refresh_tokens` / `mfa_*` / `email_tokens` 表；所有「只能成功一次」的判定均为单条条件语句，支持多副本并发。
- **凭据提供者**：`SessionAuthProvider`（Cookie）、`JwtAuthProvider`（Bearer）与 `ApiKeyAuthProvider`（`nest_<id>_<secret>`，order 2）注册进 `AuthenticationRegistry`；`UsersRepository` 读取 `user` + `account`，密码哈希不外泄；封禁用户由 `validate()` 返回 `null` 直接 401。
- **一次性命令与队列**：`MailJobs` 是 BullMQ 生产者，任何触发邮件的 `just cmd` 场景都需要 Redis（API 只入队、由 Worker 投递）。
- **业务扩展**：API Key 管理（`/auth/api-keys`，仅存 SHA-256，创建时展示一次，校验由官方 `ApiKeyProvider` 承担）、会话管理（`/auth/sessions`）与验证码（`/auth/otp/email`、`/auth/otp/phone`：6 位码、5 分钟、单次使用、60s 冷却 + 每小时 5 次、失败 5 次作废，仅做邮箱/手机号归属验证，不免密登录；`otp_codes` 上有 `unique(target, purpose)`，消费为单语句 DELETE…RETURNING，保证并发下也只有一次成功）。
- **已移除**：better-auth 兼容别名层（`sign-in/email`、`get-session`、`two-factor/*`、`api-key/*` 等）、用户名登录、一次性登录令牌、管理员冒充、`last_login_method`；magic link 与 OIDC 未启用。
- 角色: `SUPER_ADMIN / ADMIN / OPERATOR / USER`（`src/common/constants/roles.ts`），统一用户主表 `user`（UUID），前台用户与后台管理员聚合于同一张表。
- **授权 (`@nestjs/authorization`)**: deny-by-default —— 未声明 `@Can()` / `@Can.Anyone()` / `@Public()` 的路由一律拒绝。域级 policy 位于 `src/common/authorization/policies/`（`AdminPolicy` / `UserPolicy` / `IotPolicy`），在 `AppModule` 以 `AuthorizationModule.forRoot({ globalGuard: false, policies })` 注册，`AuthorizationGuard` 作为 `APP_GUARD` 排在 `AuthenticationGuard` 之后。
- **策略约定**：能力方法首参必须接受 `CurrentUserPayload | null` 才能在 `@Can()` 中使用；需要路由参数时用 `param('id')` 解析器；SUPER_ADMIN 通过 `before()` 直通管理策略。
- **路由声明**：认证端点使用 `@Can.Anyone()`（仍要求登录，除 `@Public()`）；管理端点按能力声明（如 `@Can(AdminPolicy, 'changeUserRole')`）；自助资源用 `@Can(UserPolicy, 'view', param('id'))`。
- **`@Public()`（项目自有装饰器）**：等价于官方 `@Public()`，同时满足认证放行与授权守卫的 `Anyone` 语义。

### 安全基线 (Nest 12 内置能力)

- **安全响应头与边缘网关分层**: 常见安全响应头（X-Frame-Options, X-Content-Type-Options, HSTS 等）与传输压缩由边缘反向代理/Ingress（如 Traefik / Nginx）统一接管并开启 gzip/brotli/zstd。应用层移除了冗余的响应头与压缩中间件，降低 Node.js 进程 CPU 负载并消除流式事件/大文件直出的缓冲延迟；Fastify 适配器开启 `trustProxy: true` 以确保准确提取网关转发的客户端真实 IP。
- **跨站请求防护 (CSRF)**: `app.enableCsrfProtection()` 基于 Fetch Metadata（`Sec-Fetch-Site` + Origin/Host 回退），**非令牌方案** —— 无 `Origin` / `Sec-Fetch-Site` 的服务端调用天然放行；跨域浏览器写请求需在 `TRUSTED_ORIGINS` 声明来源，第三方回调（微信支付 `*/payments/wepay/notify`）已在 `exclude` 中豁免。CORS 仍保持开放（`enableCors()`），由 CSRF 承担写请求的跨站防护。
- **内置 Cookie**: 仅在配置 `COOKIE_SECRET` 时启用（`setCookie` / `@SignedCookies()`）。
- **路由冲突诊断**: `routeConflictPolicy: { duplicate: 'error', shadow: 'warn' }` 在适配器注册前拦截重复路由（`method+path+version` 完全一致）；Fastify 为顺序不敏感适配器，框架只在该类适配器上应用 `duplicate` 策略，故 `shadow` 与 `routeResolutionStrategy` 对 Fastify 不生效（radix 路由天然静态段优先）。

### HTTP 边界能力（限流与缓存）

- **限流计数跨副本一致**: `ThrottlerModule` 必须以**对象形态**配置（数组形态会强制回落到进程内存储，多副本下限流额度被放大 N 倍）。`THROTTLE_STORAGE=redis`（默认）时由 `RedisThrottlerStorage`（`src/common/throttler/`）以单条 Lua 在 Redis 侧原子完成计数与封禁判定，键空间 `throttle:{throttlerName}:{key}`（`key` 为 @nestjs/throttler 默认 generateKey 的 SHA-256 摘要：class + handler + 名称 + 客户端标识，无明文个人信息；仍不在日志中输出）。本地无 Redis 时设 `THROTTLE_STORAGE=memory`（仅进程内计数）。
- **限流降级的两层要求（缺一不可）**: ① 语义层 —— Redis 不可用时回退进程内计数并限频告警，限流基础设施抖动不得演化为 5xx；② 时间层 —— 客户端 `status` 非 `ready`（`'wait'` 除外，那是 `lazyConnect` 冷启动，必须放行否则永不建连）时立即降级，就绪时对单次调用加 `THROTTLE_REDIS_TIMEOUT_MS`（100ms）时间上界。**守卫阶段不受 `HTTP_TIMEOUT_MS` 约束**（Nest 生命周期为 middleware → guards → interceptors），故请求热路径上的依赖调用必须自带上界：ioredis 默认 `enableOfflineQueue: true`，断连期间的命令会排进离线队列等完整个重连周期（实测单次 >7s、连续请求可达 20s）。
- **Redis Lua 脚本唯一事实源**: 全部脚本集中在 `src/database/lua-scripts.ts`，**禁止在调用处内联复制脚本文本**（历史上解锁脚本曾被复制两份）。加载策略按调用频率区分：请求热路径用 `defineCommand`（EVALSHA 优先 + NOSCRIPT 回落，避免重传脚本体），低频临界区脚本直接 `eval`。
- **邮件栈 (官方 `@nestjs/mail` + BullMQ)**: `MailModule.forRoot()` 装配传输层（`MAIL_TRANSPORT` 选择 `SmtpTransport` / `FileMailTransport` / `ResendTransport`）与 Handlebars 模板引擎（strict，MJML → `.hbs`）。`MailJobs` 只负责入队（`mail` 队列，`attempts` + 指数退避），`MailProcessor` 在 Worker 进程消费并调用 `Mailer.send`；永久失败（`MailError.permanent`）调用 `job.discard()` 终止重试。

### CLI 模块 (`src/cli.module.ts`)

独立于 `AppModule` 且免除 HTTP 守卫与 Worker 额外开销。所有带 Controller 的业务模块统一在 `src/features/index.ts` 中的 `FEATURE_MODULES` 集中声明，`AppModule` 与 `CliModule` 统一展开引入，彻底消除路由发现缺失与模块漂移。
`MailJobs` 依赖 BullMQ `mail` 队列：任何引入 `AuthModule` 的进程都必须注册 `MailModule.forRoot()` 与 `JobsModule`；实际投递由 Worker 进程的 `MailProcessor` 完成。

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
  - **未知字段策略（硬规则）**：新增写接口一律 `z.strictObject()`（未知字段报 422）；存量 `z.object()` 的 strip 行为属已发布契约，收紧必须单独评估；第三方回调（微信支付 / Centrifugo Proxy）永远保持 `z.object()`，避免上游新增字段打断回调。
  - **禁止占位校验**：不得用 `z.any()` / `z.unknown()` 代替真实规则（等于关闭校验）；确需透传的字典型字段用 `z.record(z.string(), z.unknown())` 并限定键与大小上限。
  - **禁止二次校验**：管道已经执行 schema 校验与归一化（`trim` / `z.coerce` / `.default()`），service 与 handler 不得再 `parse` 或重复清洗；需“只校验不改写”时用 `transform: false` 并把类型写成 `z.input<>`。
  - **自定义参数装饰器**：`createParamDecorator` 的参数默认不被校验，`createApiValidationPipe()` 已开启 `validateCustomDecorators: true`；新写自定义装饰器携带 `schema` 时无需额外配置。
- **日志**: 业务服务、控制器与基础设施使用注入的 `Logger` (Pino)，严禁在业务逻辑中使用 `console.log`（CLI / Seeder 终端输出除外）。
  - **原生极速架构**: 彻底消除 `nestjs-pino` / `pino-http` 额外包装层，基于原生 `@Global()` `LoggerModule` 与 `PinoLoggerService` 实现。
  - **单通道 stdout**: 生产输出单行 JSON（带 `service`/`hostname` 基字段与 ISO 时间，便于多进程 / 多副本归集），开发 / 测试输出 `pino-pretty` 彩色单行。**不落盘**：日志留存交容器日志驱动（根 `docker-compose.yml` 的 `json-file` 上限，`api` 与 `worker` 服务复用 `x-app` 锚点同一 `logging` 块）；Pino `mixin` 注入 `trace_id`/`span_id`（无活动 span 零开销），otel-collector `filelog` 采集容器 stdout 后三信号在 OpenObserve 内互相关联。
  - **依赖形态约束**: `pino-pretty` 属 devDependencies（生产镜像 `bun install --production` 不含它），故**必须动态导入**（`await import('pino-pretty')`）；任何对 devDependency 的静态导入都会让生产进程启动即崩，`tests/unit/setup/logger.config.test.ts` 已加回归锁。
  - **框架噪音过滤**: `SILENT_BOOTSTRAP_CONTEXTS` 自动静默 `InstanceLoader`、`RoutesResolver`、`RouterExplorer` 和 `NestApplication` 的 `INFO` 级别日常输出，WARN / ERROR 异常无损放行。
  - **APM 选型**: 不接入 `@nestjs/observe`（供应商型 APM agent，需外部凭证与 SaaS 采集端），走标准 OpenTelemetry 自托管链路：`src/setup/otel/telemetry.ts`（副作用模块，main/worker 先导）按官方标准 env（`OTEL_EXPORTER_OTLP_ENDPOINT` 等）初始化 NodeSDK，traces + metrics 经 OTLP/HTTP+protobuf 推 otel-collector；**未配置 endpoint 时零初始化**（动态 import 均不执行）。纯 ESM 约束：require-hook 类探针（ioredis/pg）不生效，HTTP server spans 由 `@fastify/otel`（diagnostics-channel，`registerOnInitialization: true` 自动挂接全部 Fastify 实例）承担，出站 fetch 由 undici 探针承担。优雅关停经 `shutdownTelemetry()` flush。
- **分层异常处理 (Tiered Exception Handling)**:
  - **Controller 层**: 严禁写任何 `try-catch`，所有错误 100% 冒泡交由全局过滤器。
  - **Service 层 (常规)**: 默认不写 `try-catch` 包裹正常业务，业务校验失败直接直抛标准异常 (`NotFoundException` / `BadRequestException` 等)。
  - **Service 层 (白名单 catch)**: 仅在以下 3 类场景允许使用 `try-catch`：
    1. **资源补偿与回滚**: 如写盘成功但落库失败时，推荐使用 `MediaService.storeWithCompensation` 自动安全接管。
    2. **弱依赖旁路降级**: 如删除旧头像、非核心日志记录，catch 后记录 warn，不阻断主流程。
    3. **领域错误转译**: 捕获专有驱动异常并转译为语义明确的业务异常。
  - **守卫层**: 认证由官方 `AuthenticationGuard` 负责；凭据无效或账号封禁映射 401，认证存储不可用时由官方错误映射为非 401 状态并记录日志。
  - **全局过滤器 (`HttpExceptionFilter`)**: 统一响应格式、生产环境 SQL/堆栈脱敏，自动识别 Postgres 错误码（如 `23505` 唯一键冲突 → 409 Conflict、`23503` 外键无效 → 400 Bad Request），并优先采用 `HttpExceptionOptions.errorCode` 作为机器可读错误码（其次响应体 `code`，最后状态枚举名）。
- **Swagger / OpenAPI 规范**:
  - **中文极简命名**: 所有 Controller 的 `@ApiTags`（如 `@ApiTags('用户管理')`、`@ApiTags('认证')`）与 `@ApiOperation({ summary })`（如 `@ApiOperation({ summary: '创建用户' })`、`@ApiOperation({ summary: '登录' })`）统一采用纯粹、简明的中文表达，严禁中英混杂或冗长套话。
  - **禁写 `@ApiErrorResponse`**: 全局统一异常过滤器 (`HttpExceptionFilter`) 已经 100% 接管所有错误状态码与统一错误响应信封结构，Controller 层**严禁/无需声明任何 `@ApiErrorResponse`**，以保持控制器注解精简清爽。
- **工具库标准 (es-toolkit 优先规范)**:
  - **唯一首选**: 项目全面拥抱 `es-toolkit` (2~3x 极速、纯 ESM、类型安全)。严禁引入 Lodash / Underscore / Ramda 等老旧或体积庞大的工具库。
  - **按需引入与场景速查表**:

    | 场景领域                | 推荐 API                                                                      | 典型应用范式                                                                                                                                             |
    | :---------------------- | :---------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | **对象清洗与 DTO 映射** | `pick`, `omit`, `cloneDeep`, `toMerged`                                       | `pick(entity, ['id', 'name', 'email'])` 抽取 API 返回字段；`omit(row, ['passwordHash'])` 剔除敏感属性；`pick(dto, ['name', 'avatarUrl'])` 提炼更新载荷。 |
    | **集合计算与批处理**    | `uniq`, `uniqBy`, `chunk`, `compact`, `groupBy`, `keyBy`, `sortBy`, `orderBy` | `uniq(guardNames)` 替代 `[...new Set(...)]`；`chunk(ids, 500)` 批处理数据库与队列任务；`compact(urls)` 清除空值；`groupBy(logs, 'level')` 统计汇总。     |
    | **异步流控与延时**      | `delay`, `retry`, `withTimeout`, `debounce`, `throttle`                       | `await delay(200)` 恒定时间侧信道防御与定时等待；`await retry(fn, { retries: 3 })` 外部网络与 S3 I/O 容灾重试；`withTimeout` 防挂死。                    |
    | **字符串与命名**        | `camelCase`, `pascalCase`, `snakeCase`, `kebabCase`, `deburr`                 | 统一从 `es-toolkit/string` 导入；`deburr(text)` 分解重音字符；`kebabCase(name)` 命名策略。                                                               |
    | **类型守卫与安全计算**  | `isNil`, `isEmptyObject`, `isPlainObject`, `clamp`                            | `isNil(val)` 替代 `val === null \|\| val === undefined`；`clamp(size, 1, 100)` 约束分页与数值边界。                                                      |

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
- **Docker**: 根目录 `Dockerfile` 多阶段构建 (oven/bun:1.4-alpine)，生产镜像不含源码与 devDeps（**故运行时代码不得静态导入 devDependency**）。启动前门统一为 `dist/cli.js`：镜像 `ENTRYPOINT` 为 `tini -- bun run dist/cli.js`，`CMD` 默认 `serve`，`worker` 通过编排器 args 覆写（**已无 shell 分发脚本**，需诊断命令时用 `docker run --entrypoint`），**不存在由 env 二次分叉的空间**：`serve` 只提供 HTTP，队列消费恒由独立 `worker` 进程承担。交付编排：根 `docker-compose.yml` 以 `x-app: &app` 锚点 + `build: .` 启动 `api` 与 `worker` 双服务，`deploy/docker-compose.yml` 以 `include: ../docker-compose.yml` 汇入并聚合 `centrifugo/`、`imgproxy/`、`meilisearch/`、`mosquitto/`、`otelcol/`。容器栈环境变量统一读 `deploy/.env`（service hostname DSN），根 `.env` 仅本地开发。

## 易踩坑

1. **新增业务模块只需加入 `FEATURE_MODULES`** — 在 `src/features/index.ts` 中声明即可自动挂入 `AppModule` 与 `CliModule`，保障 CLI 路由发现完整。
2. **新增管理端点必须落 `/admin` 前缀** — 在 `src/features/admin/{users,notifications,dashboard,admins}/` 对应领域子目录内新增/扩展，并在 `AdminPolicy` 中声明对应能力、路由上标注 `@Can(AdminPolicy, 'ability')`；未声明的路由会被授权守卫默认拒绝。前端自助端点（`/users/me` 等）不得迁入 `/admin`。
3. **`MailJobs` 依赖 BullMQ** — 任何间接 import `AuthModule` 的场景都要注册 `MailModule.forRoot()` 与 `JobsModule`；邮件只在 Worker 进程（`MailProcessor`）真正投递。
4. **Fastify 5 ≠ Express** — 用 `@nestjs/platform-fastify`，第三方插件/中间件需 Fastify 5 兼容版本；`req`/`reply` 类型不同；响应耗时用 `reply.elapsedTime`（严禁使用已弃用的 `reply.getResponseTime()`）。
5. **纯 ESM 运行时规范** — 项目已声明 `"type": "module"`，严禁直接使用 CJS 全局变量 `__dirname` / `__filename`，统一使用 `import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url))`；SWC 配置需保持 `module.resolveFully: true` 以确保相对导入携带 `.js` 扩展名。
6. **SWC 构建与资源拷贝** — SWC 仅做转译，类型检查用 `tsc --noEmit`；构建时需通过 `tsconfig.build.json` 锁定 `"rootDir": "src"`，防止 Nest CLI 误判项目根目录导致 assets 资源拷贝偏移至 `dist/src/`。
7. **启动日志降噪机制** — 启动时不输出数十行 `InstanceLoader` 与路由映射属于设计内行为（由 `SILENT_BOOTSTRAP_CONTEXTS` 静默）；完整路由树请运行 `just cmd route:list` 查看。
8. **`storage/uploads`** 由业务 `fsPromises.mkdir({recursive:true})` 创建，无需手动建目录；应用日志走单通道 stdout，不落盘（原 `storage/logs` 目录已随 k6 套件移除）。
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
- **结构化批量重构**: 对 import/装饰器等有语法结构的重复改动，用 `ast-grep run -p <pattern> --rewrite <replacement> --update-all <path>` 先以 stdin 验证再全量应用。
- **验证**: 改动前 `rg` 定位所有关联位置防漏改；改动后 `just check`（fix + fmt + type + i18n-check）。

## Agent skills

- **Issue tracker**: issues 以 markdown 存于 `.scratch/<feature-slug>/`，见 `docs/agents/issue-tracker.md`。
- **Triage labels**: `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`，见 `docs/agents/triage-labels.md`。
- **Domain docs**: `CONTEXT.md` + `docs/adr/` 单上下文布局，见 `docs/agents/domain.md`。
