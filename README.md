# nest-api <!-- rumdl-disable-line first-line-heading -->

现代、开箱即用的 NestJS 12 + Fastify 5 企业级后端脚手架。
基于纯 ESM 架构构建，集成 Better Auth 认证生态、Drizzle ORM、BullMQ 异步队列、Centrifugo 实时广播中枢、MQTT 5.0 物联网总线、Meilisearch 全文检索、imgproxy 媒体处理、高可用弹性治理及 Vitest 5 测试套件。

---

## ✨ 核心特性

- 🔐 **现代认证体系 (Better Auth)**：开箱支持账号密码、Passkey/WebAuthn 免密登录、One-Tap、OAuth (Google)、两步验证 (TOTP)、邮件魔术链接、手机号 OTP、API Key、组织多租户与多端会话管理。
- 👥 **细粒度权限控制**：基于角色的访问控制 (`SUPER_ADMIN / ADMIN / OPERATOR / USER`) 与声明式动作权限 (`@Roles()`, `@Permissions()`)，管理面端点由全局 `AdminPrefixGuard` 实施强制隔离。
- 📡 **统一实时通信中枢**：基于 Centrifugo 无状态广播中枢（对齐 Laravel Broadcasting），支持 WebSocket / SSE 双协议长连接、模式匹配频道授权 (`@ChannelAuth`) 与 Presence 在线感知。
- 🔍 **Laravel Scout 风格全文检索**：抽象化搜索驱动（Meilisearch / Noop），提供模型 `Searchable` 契约，支持 BullMQ 队列异步索引同步与条件高亮检索。
- ⚡ **工业物联网 (MQTT 5.0) 总线**：支持 Mosquitto / EMQX，提供声明式 `@MqttSubscribe()` 模式匹配路由、RPC 指令下发与遥测影子，内置虚拟设备仿真。
- 🛡️ **高可用弹性与安全防护**：自适应过载保护 (`LoadShedding`)、`CircuitBreaker` 熔断降级、**跨副本一致限流**（`@nestjs/throttler` + Redis 原子 Lua）、请求超时拦截、内置安全响应头、**响应压缩**（`@fastify/compress`，br/gzip）、Gitleaks 凭据防护与 CIS 容器安全（`tini` PID 1 + 非 root 运行）。
- 🖼️ **动态媒体处理与事务存储**：集成 imgproxy JIT 实时动态渲染与 HMAC-SHA256 签名，纯 JS 元数据探测、矢量二维码，支持 Local 与 S3 双驱动及补偿性事务存储 (`storeWithCompensation`)。
- 🗄️ **持久化与缓存队列**：Drizzle ORM 0.45 + PostgreSQL 18（原生 `uuidv7()`、多文件 Schema）、Redis 分布式锁与穿透缓存、BullMQ 异步队列与 Bull Board 可视化看板。
- 📄 **三合一 Scalar API 交互文档**：客户端 API (`/docs`)、管理后台 API (`/docs/admin`) 与 Better Auth 专有参考 (`/docs/auth`) 物理隔离并支持在线调试。
- 🪵 **企业级极速可观测性**：原生 Pino 极速流日志、OpenTelemetry 三信号归集（logs/metrics/traces → OpenObserve）、Terminus 基础设施就绪探针 (`/readyz`) 与云原生存活探针 (`/livez`)。
- 🛠️ **卓越开发者体验**：纯 ESM 规范、Bun 1.4.2 + Node ≥ 24、SWC 极速编译、Vitest 5 单元/集成测试、oxlint + oxfmt 代码检查与 Just 任务自动化。

---

## 🧱 技术栈

| 层次         | 选型与技术                       | 说明                                                   |
| :----------- | :------------------------------- | :----------------------------------------------------- |
| **运行时**   | Bun ≥ 1.2 + Node ≥ 24            | 纯 ESM (`"type": "module"`)，安装与执行高效可复现      |
| **核心框架** | NestJS 12 + Fastify 5            | 极速底层 HTTP 驱动，避免 Express 性能瓶颈              |
| **持久层**   | Drizzle ORM 0.45 + PostgreSQL 18 | 原生 `uuidv7()` 主键，多文件模块化 Schema 与原生 DDL   |
| **认证授权** | Better Auth 1.7+                 | 14+ 插件全家桶，集成本地凭据、OAuth、Passkey 与 2FA    |
| **缓存队列** | Redis 6+ + BullMQ                | 分布式排他锁、穿透缓存与异步任务队列                   |
| **实时中枢** | Centrifugo 6+                    | 纯粹无状态实时发布中枢，支持 WebSocket / SSE           |
| **全文检索** | Meilisearch / Noop               | Laravel Scout 风格驱动抽象，模型属性映射与队列异步同步 |
| **物联通信** | MQTT 5.0 (Mosquitto)             | 工业物联网与遥测指令总线，声明式注解订阅               |
| **媒体处理** | imgproxy + Sharp-free 工具链     | JIT 实时动态渲染、纯 JS 元数据提取、矢量二维码         |
| **数据校验** | Zod 4 + Standard Schema          | Nest 12 原生 Standard Schema 校验通道与白名单序列化    |
| **API 文档** | OpenAPI 3.1 + Scalar UI          | 客户端、管理后台与认证专有三份独立隔离交互文档         |
| **代码质量** | oxlint + oxfmt + Gitleaks        | 毫秒级 Lint、代码格式化与凭据泄漏防护                  |
| **测试套件** | Vitest 5                         | 高速单元测试与 E2E 端到端集成测试                      |
| **任务编排** | Just (justfile)                  | 统一声明式命令入口，消除长参数脚本记忆成本             |

---

## 📁 目录结构

```text
├── deploy/            # 统一交付与运维编排 (Docker 容器集群 + Kubernetes Helm Chart)
├── storage/           # 运行时数据 (cache, logs, tmp, uploads，由 git 忽略)
├── tests/             # Vitest 单元测试、E2E 测试与数据工厂
└── src/
    ├── common/        # 全局基础设施与深模块
    │   ├── auth/          # Better Auth 配置与插件装配
    │   ├── constants/     # 角色、权限、路由与系统级常量
    │   ├── decorators/    # @CurrentUser, @Roles, @Permissions 等
    │   ├── media/         # imgproxy 渲染、元数据检测与二维码生成
    │   ├── resilience/    # 熔断器 (CircuitBreaker)、过载保护 (LoadShedding)、限流
    │   ├── search/        # Laravel Scout 风格搜索引擎驱动与服务
    │   └── storage/       # 本地 / S3 驱动与补偿性文件事务存储
    ├── config/        # 强类型环境变量与统一 DSN 配置校验 (Zod)
    ├── database/      # 数据库与存储核心 (drizzle/, search/, seeds/)
    ├── commands/      # Nest Commander CLI 命令 (route:list, db:seed, jwt:secret 等)
    ├── realtime/      # 统一实时通信中枢 (Centrifugo 发布 + 模式鉴权 + 多协议路由)
    ├── iot/           # 统一工业物联网中枢 (MQTT 5.0 客户端 + 声明式订阅 + 遥测影子)
    ├── features/      # 业务特性层 (client/, admin/, system/)
    ├── jobs/          # 异步队列契约与消费者 (mail, media, search, token-cleanup)
    ├── schedules/     # 集中式定时任务调度声明
    ├── setup/         # Fastify 插件、中间件管道、原生 Pino 日志与 Scalar 文档挂载
    ├── bootstrap/     # 进程引导体 (server / worker)，由 CLI 命令调用
    ├── workers/       # Worker 模块 (worker.module.ts，只消费队列)
    ├── app.module.ts  # 主 HTTP 模块
    └── cli.ts         # 唯一启动前门 (serve / worker / 一次性命令)
```

---

## 🚀 快速开始

### 前置要求

- **运行时**：[Node.js](https://nodejs.org/) ≥ 24 与 [Bun](https://bun.sh/) 1.4.2
- **容器环境**：Docker 与 Docker Compose
- **自动化工具**：[Just](https://github.com/casey/just) 命令行任务运行器（`brew install just`）

---

### 启动方式 A：Docker 一键全栈模式 (推荐)

一键拉起包括 API 主服务、Centrifugo、Meilisearch、imgproxy 与 Mosquitto 的完整集群：

```bash
# 1. 复制环境变量
cp .env.example .env

# 2. 一键拉起全栈 Docker 容器集群
just docker-up

# 3. 应用迁移并灌入种子数据（全新库用 just db-fresh 可一步重建）
just db-migrate
just db-seed
```

---

### 启动方式 B：本地敏捷开发模式

若在本地直接运行 PostgreSQL (5432) 与 Redis (6379) 等依赖：

```bash
# 1. 复制环境变量
cp .env.example .env

# 2. 安装项目依赖
bun install

# 3. 应用迁移并灌入初始测试数据
just db-migrate
just db-seed

# 4. 启动开发服务器（API + Worker 双进程，支持热更新与 SWC）
just dev
```

> **提示**：`just dev` 并发拉起 API 与 Worker 两个进程，与生产容器拓扑保持一致；日志以 `[app]` / `[worker]` 前缀区分，`Ctrl-C` 同时停止两者。

---

## 🌐 常用服务与控制台

服务成功启动后，可通过以下端口与路径直接访问：

| 服务 / 控制台                  | 访问地址                           | 默认凭据 / 说明                                          |
| :----------------------------- | :--------------------------------- | :------------------------------------------------------- |
| **客户端 API 文档 (Scalar)**   | `http://localhost:4300/docs`       | 客户端公共业务接口与在线调试                             |
| **管理后台 API 文档 (Scalar)** | `http://localhost:4300/docs/admin` | 管理后台自包含领域接口（带 `/v1/admin` 前缀）            |
| **Better Auth 认证 API 文档**  | `http://localhost:4300/docs/auth`  | 14+ 认证插件全量端点参考手册                             |
| **云原生就绪探针 (Readiness)** | `http://localhost:4300/readyz`     | 实时检测 DB、Redis、实时、搜索、存储等依赖健康与停机状态 |
| **云原生存活探针 (Liveness)**  | `http://localhost:4300/livez`      | 快速返回 200 ok，用于容器/Pod 存活检测                   |
| **Prometheus 监控指标**        | `http://localhost:4300/metrics`    | 生产级 Prometheus 格式指标输出                           |
| **Centrifugo 实时管理控制台**  | `http://localhost:8000`            | 实时连接、频道订阅与广播监控                             |
| **Mailpit 本地邮件测试控制台** | `http://localhost:8025`            | 捕获并直观查看系统外发的邮件模板                         |

---

## 🔑 认证与权限

### 测试账号 (Seed Data)

执行 `just db-seed` 后，系统会自动装配初始测试账号：

| 角色标识      | 邮箱                   | 初始密码         | 角色说明                                      |
| :------------ | :--------------------- | :--------------- | :-------------------------------------------- |
| `SUPER_ADMIN` | `admin@example.com`    | `admin123456`    | 超级管理员，具备全量管理与系统配置权限        |
| `OPERATOR`    | `operator@example.com` | `operator123456` | 运营管理员，具备常规业务运维与审计权限        |
| `USER`        | `user@nestforge.dev`   | `password123`    | 固定测试普通用户（同时会生成 100 位随机用户） |

### 统一角色与细粒度权限

系统采用统一用户主表（`user`），前台用户与后台管理员聚合于同一身份源并分配角色：

- **角色枚举 (`Role`)**：`SUPER_ADMIN` / `ADMIN` / `OPERATOR` / `USER`
- **后台准入保护**：所有以 `/admin` 为前缀的路由自动受全局 `AdminPrefixGuard` 保护，仅限合法管理角色访问（登录等白名单端点通过 `@Public()` 豁免）。
- **控制器注解示例**：

  ```typescript
  // 角色级保护
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  // 细粒度声明式权限保护
  @Permissions(Permission.UserCreate)
  ```

---

## 🛠️ 常用命令 (Justfile)

同一个镜像承载三种进程类型，由镜像 `CMD` / 编排器 args 指定的 CLI 子命令唯一确定（不存在由 env 二次决定的空间）：

| verb     | 本地命令          | 容器命令                     | 用途                                    |
| :------- | :---------------- | :--------------------------- | :-------------------------------------- |
| `serve`  | `just serve`      | 默认（`CMD ["serve"]`）      | HTTP API，队列由独立 worker 消费        |
| `worker` | `just worker`     | `command: ["worker"]`        | 消费队列与定时任务，不提供 HTTP         |
| `cli`    | `just cli <命令>` | `command: ["cli", "<命令>"]` | 一次性 CLI，如 `route:list` / `db:seed` |

> 启动前门统一为 `dist/cli.js`：镜像 `ENTRYPOINT` 直接 exec `bun run dist/cli.js`，本地 `just` 也走同一 CLI 命令（`serve` 含别名 `server`），引导体集中在 `src/bootstrap/`。`entrypoint.sh`、`src/main.ts`、`src/workers/worker.main.ts` 均已删除；容器内需要额外命令时用 `docker run --entrypoint` 覆盖。

```bash
# --- 开发与运行 ---
just dev                  # 开发模式 (API + Worker 双进程 + SWC Watch)
just build                # 生产构建 (SWC 转译到 dist/)

# --- 质量与门禁 ---
just check                # 提交前完整检查 (fix + fmt + type + secret-check + i18n-check)
just type                 # TypeScript 类型检查 (tsc --noEmit)
just lint                 # oxlint 静态检查
just fix                  # 自动修复 Lint 与格式化问题
just fmt                  # oxfmt 代码格式化
just secret-check         # 扫描潜在密钥与敏感凭据泄漏 (gitleaks)
just check-deprecated     # 扫描项目中已废弃 (@deprecated) 的依赖与符号
just outline <path>       # 查看文件或目录的紧凑 AST 结构大纲

# --- 测试与基准压测 ---
just test                 # 运行 Vitest 单元测试
just test-watch           # 单元测试 Watch 模式
just test-cov             # 单元测试覆盖率报告
just test-e2e             # 运行 E2E 端到端集成测试

# --- 数据库与 Better Auth ---
just db-gen               # 生成 Drizzle 迁移 SQL
just db-migrate           # 应用数据库迁移 (开发与生产)
just db-seed              # 清空所有表数据 + 灌种子 (保留表结构)
just db-fresh             # 删表重建 + 重跑迁移 + 灌种子 (破坏性)
just db-studio            # 启动 Drizzle Studio 可视化管理
just db-reset             # 同 db-fresh (破坏性重置)
just ba-migrate           # 生成并应用 Better Auth 表结构变更
just ba-generate          # 依据 better-auth.ts 重新生成 Drizzle Schema
just ba-secret            # 生成新的 Better Auth secret
just ba-info              # 显示系统与 Better Auth 配置信息

# --- 容器与实时服务 ---
just docker-up            # 启动全栈 Docker 容器集群 (API + 实时 + 基础设施)
just docker-down          # 停止全栈 Docker 容器集群
just realtime             # 启动 Centrifugo 独立实时服务容器
just realtime-down        # 停止 Centrifugo 独立实时服务容器
just realtime-health      # 检查 Centrifugo 健康状态
just mqtt-passwd          # 生成/更新 Mosquitto 凭据
just mqtt-acl             # 初始化 Mosquitto ACL 规则文件

# --- 工程化与 CLI ---
just mail-build           # 编译 MJML 邮件模板为 Handlebars (.hbs)
just i18n-gen             # 生成 i18n TypeScript 强类型定义
just i18n-check           # 校验多语言翻译字典键值对称性
just cmd <command>        # 运行 TS CLI (如 `just cmd route:list`)
just cmd app:init         # 幂等初始化：鉴权密钥 / 数据库迁移 / S3 桶
just cli <command>        # 运行生产构建 CLI (node dist/cli.js)
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
