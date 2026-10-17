nest-api <!-- rumdl-disable-line first-line-heading -->

现代、开箱即用的 NestJS 12 + Fastify 5 企业级后端脚手架。
基于纯 ESM 架构构建，集成 Better Auth 完整认证生态、Drizzle ORM、BullMQ 异步队列、Centrifugo 实时广播中枢、MQTT 5.0 物联网总线、Meilisearch 全文搜索、imgproxy 动态媒体处理、高可用弹性治理及 Vitest 5 测试环境。

---

## ✨ 核心特性

- 🔐 **现代认证体系 (Better Auth)**：基于 Drizzle 适配器，开箱支持账号密码、Passkey/WebAuthn 免密认证、One-Tap 快捷登录、匿名访问、Google OAuth、两步验证 2FA (TOTP)、邮件魔术链接、手机号 OTP、API Key、组织多租户 (Organization) 与多端会话管理。
- 👥 **细粒度权限控制**：基于角色的访问控制 (`SUPER_ADMIN / ADMIN / OPERATOR / USER`) 与声明式动作权限校验 (`@Roles()`, `@Permissions()`)，管理面端点由全局 `AdminPrefixGuard` 实施强制隔离与准入保护。
- 📡 **统一实时通信中枢**：基于 Centrifugo 纯粹无状态实时发布中枢（对齐 Laravel Broadcasting 理念），支持 WebSocket 与 SSE 双协议长连接、模式匹配频道授权 (`@ChannelAuth`) 与 Presence 在线状态感知，业务领域与传输协议彻底解耦。
- 🔍 **Laravel Scout 风格全文搜索**：抽象化搜索驱动（Meilisearch / Noop 空驱动），提供模型 `Searchable` 契约定义，支持 BullMQ 队列异步索引同步与条件高亮检索。
- ⚡ **工业物联网 (MQTT 5.0) 总线**：支持 Mosquitto / EMQX 客户端，提供声明式 `@MqttSubscribe()` 模式匹配路由、RPC 远程指令下发与遥测指标采集，内置虚拟 PLC 设备仿真。
- 🛡️ **高可用弹性治理与安全防护**：自适应系统过载保护 (`LoadShedding`)、`CircuitBreaker` 熔断降级、**跨副本共享限流计数**（`@nestjs/throttler` + Redis 原子 Lua，故障自动降级为进程内）、请求超时拦截、框架内置安全响应头（默认与 helmet 8 等价）、**响应压缩**（`@fastify/compress`，br/gzip，SSE 与已压缩二进制自动豁免）、CORS 与 Zod 强类型数据校验。
- 🖼️ **动态媒体处理与事务存储**：集成 imgproxy 实时动态图像渲染与 HMAC-SHA256 安全签名，纯 JS 元数据探测、矢量二维码生成，支持 Local 与 S3 双驱动及事务性存储补偿机制 (`storeWithCompensation`)。
- 🗄️ **持久化与缓存队列**：Drizzle ORM 0.45 + PostgreSQL（多文件 Schema 与独立 DDL 审计）、Redis 分布式排他锁与穿透缓存、BullMQ 异步队列与 Bull Board 可视化看板。
- 📄 **三合一 Scalar API 交互文档**：客户端 API (`/docs`)、管理后台 API (`/docs/admin`) 与 Better Auth 专有参考 (`/docs/auth`) 物理隔离，提供现代化、可在线调试的接口体验。
- 🪵 **企业级极速可观测性**：原生 Pino 极速流日志（控制台彩色高亮 + 单通道 stdout JSON）、OpenTelemetry 三信号归集（logs/metrics/traces 经 otel-collector 推送 OpenObserve，日志-链路互相关联）、Terminus 健康检查 (`/health` 覆盖 7 大子系统探针)。
- 🛠️ **卓越开发者体验**：纯 ESM 规范、Bun 1.4.2（`packageManager` 字段固定，安装可复现）+ Node ≥ 24 运行时、SWC 极速编译、Vitest 5 单元/集成测试、k6 负载压测套件、oxlint + oxfmt 代码检查与 Just 任务自动化。

---

## 🧱 技术栈

| 层次                 | 选型与技术                    | 说明                                                |
| :------------------- | :---------------------------- | :-------------------------------------------------- |
| **运行时**     | Bun ≥ 1.2 + Node ≥ 24       | 纯 ESM (`"type": "module"`)，支持极速启动与执行   |
| **核心框架**   | NestJS 12 + Fastify 5         | 极速底层 HTTP 驱动，避免 Express 性能瓶颈           |
| **持久层**     | Drizzle ORM 0.45 + PostgreSQL | 多文件 Schema 模块化组织，提供独立建表 DDL          |
| **认证授权**   | Better Auth 1.7+              | 14+ 插件全家桶，集成本地凭据、OAuth、Passkey 与 2FA |
| **缓存与队列** | Redis 6+ + BullMQ             | 分布式锁、穿透缓存与异步任务队列                    |
| **实时中枢**   | Centrifugo 6+                 | 纯粹无状态实时发布中枢，支持 WebSocket / SSE        |
| **全文搜索**   | Meilisearch / Noop            | Laravel Scout 风格抽象，模型属性映射与队列异步同步  |
| **物联通信**   | MQTT 5.0 (Mosquitto)          | 工业物联网与遥测指令总线，声明式订阅                |
| **媒体处理**   | imgproxy + Sharp-free 工具链  | JIT 实时动态渲染、纯 JS 元数据提取、矢量二维码      |
| **数据校验**   | Zod 4 + nestjs-zod            | 全链路强类型请求校验与响应过滤                      |
| **API 文档**   | OpenAPI 3.1 + Scalar UI       | 客户端、管理后台与认证专有三份独立隔离交互文档      |
| **代码规范**   | oxlint + oxfmt + ast-grep     | 毫秒级代码 Lint、格式化与 AST 架构规则静态守卫      |
| **测试套件**   | Vitest 5 + k6                 | 高速单元测试、E2E 测试与全场景性能压力测试          |
| **任务编排**   | Just (justfile)               | 统一声明式命令入口，消除长参数脚本记忆成本          |

---

## 📁 目录结构

```text
├── deploy/            # 统一交付与运维编排 (Docker 容器集群 + Kubernetes Helm Chart)
├── storage/           # 运行时数据 (cache, logs, tmp, uploads，由 git 忽略)
├── tests/             # Vitest 单元测试、E2E 测试、数据工厂与 k6 压测套件
└── src/
    ├── common/        # 全局基础设施与深模块
    │   ├── auth/          # Better Auth 客户端配置与插件装配
    │   ├── constants/     # 角色、权限、路由与系统级常量
    │   ├── decorators/    # @CurrentUser, @Roles, @Permissions 等
    │   ├── media/         # imgproxy JIT 渲染、元数据检测与二维码生成
    │   ├── resilience/    # 熔断器 (CircuitBreaker)、过载保护 (LoadShedding)、滑动窗口限流
    │   ├── search/        # Laravel Scout 风格搜索引擎驱动与服务
    │   └── storage/       # 本地 / S3 驱动与补偿性文件事务存储
    ├── config/        # 强类型环境变量与统一 DSN 配置校验 (Zod)
    ├── database/      # 数据库与存储核心
    │   ├── drizzle/       # Drizzle 表结构 (schema/) 与原生 PostgreSQL DDL (sql/)
    │   ├── search/        # 模型全文索引定义 (*.searchable.ts)
    │   └── seeds/         # 模块化种子数据 (admin.seed.ts, user.seed.ts)
    ├── commands/      # Nest Commander CLI 命令 (route:list, db:seed, jwt:secret 等)
    ├── realtime/      # 统一实时通信中枢 (Centrifugo 发布 + 模式鉴权 + 多协议路由 + 领域事件)
    ├── iot/           # 统一工业物联网中枢 (MQTT 5.0 客户端 + 声明式订阅 + 遥测影子 + 同步 RPC)
    ├── features/      # 统一业务特性层 (按端与领域严格正交划分)
    │   ├── client/        # 客户端业务特性 (auth, users)
    │   ├── admin/         # 管理后台自包含领域 (dashboard, notifications, users)
    │   └── system/        # 系统/基础设施服务 (health)
    ├── jobs/          # 异步队列契约与消费者 (mail, media, search, token-cleanup)
    ├── schedules/     # 集中式定时任务调度声明
    ├── setup/         # Fastify 插件、中间件管道、原生 Pino 日志与 Scalar 文档挂载
    ├── workers/       # 独立 Worker 进程入口 (仅消费队列与运行调度器)
    ├── app.module.ts  # 主 HTTP 模块
    └── main.ts        # HTTP bootstrap 入口
```

---

## 🚀 快速开始

### 前置要求

- **运行时**：[Node.js](https://nodejs.org/) ≥ 24 与 [Bun](https://bun.sh/) 1.4.2（版本由 `package.json` 的 `packageManager` 字段固定，安装结果可复现）
- **容器环境**：Docker 与 Docker Compose
- **自动化工具**：[Just](https://github.com/casey/just) 命令行任务运行器（推荐，`brew install just`）

---

### 启动方式 A：Docker 一键全栈模式 (推荐)

一键拉起包括 API 主服务、Centrifugo、Meilisearch、imgproxy 与 Mosquitto 的完整集群：

```bash
# 1. 复制环境变量
cp .env.example .env

# 2. 一键拉起全栈 Docker 容器集群
just docker-up

# 3. 执行数据库迁移与种子数据填充
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

# 3. 执行数据库迁移并灌入初始测试数据
just db-migrate
just db-seed

# 4. 启动开发服务器（单进程内嵌 Worker，支持热更新与 SWC）
just dev
```

> **提示**：若需要模拟高并发双进程生产架构（API 主进程 + 独立 Worker 进程），可运行 `just dev-all`。

---

## 🌐 常用服务与控制台

服务成功启动后，可通过以下端口与路径直接访问：

| 服务 / 控制台                        | 访问地址                             | 默认凭据 / 说明                                 |
| :----------------------------------- | :----------------------------------- | :---------------------------------------------- |
| **客户端 API 文档 (Scalar)**   | `http://localhost:4300/docs`       | 客户端公共业务接口与在线调试                    |
| **管理后台 API 文档 (Scalar)** | `http://localhost:4300/docs/admin` | 管理后台自包含领域接口（带 `/v1/admin` 前缀） |
| **Better Auth 认证 API 文档**  | `http://localhost:4300/docs/auth`  | 14+ 认证插件全量端点参考手册                    |
| **BullMQ 任务队列控制台**      | `http://localhost:4300/queues`     | 异步任务运行状态、重试与失败监控                |
| **系统健康检查探针**           | `http://localhost:4300/health`     | 实时检测 DB、Redis、实时、搜索、存储等健康状态  |
| **Prometheus 监控指标**        | `http://localhost:4300/metrics`    | 生产级 Prometheus 格式指标输出                  |
| **Centrifugo 实时管理控制台**  | `http://localhost:8000`            | 实时连接、频道订阅与广播监控                    |
| **Mailpit 本地邮件测试控制台** | `http://localhost:8025`            | 捕获并直观查看系统外发的邮件模板                |

---

## 🔑 认证与权限

### 测试账号 (Seed Data)

执行 `just db-seed` 后，系统会自动装配具有代表性的初始测试账号：

| 角色标识        | 邮箱                     | 初始密码           | 角色说明                                      |
| :-------------- | :----------------------- | :----------------- | :-------------------------------------------- |
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

```bash
# --- 开发与构建 ---
just dev                  # 开发模式 (单进程内嵌 Worker + SWC Watch)
just dev-all              # 开发模式 (并发启动应用 + 独立 Worker 进程)
just build                # 生产构建 (SWC 转译到 dist/)
just start-embedded       # 生产模式 (单进程内嵌 Worker)
just start-worker         # 仅启动独立 Worker 消费进程

# --- 代码质量门禁 ---
just check                # 提交前完整检查 (fix + fmt + type + sg-lint + sg-test)
just type                 # TypeScript 类型检查 (tsc --noEmit)
just lint                 # oxlint 静态检查
just fix                  # 自动修复 Lint 与格式化问题
just sg-lint              # ast-grep 架构规则静态检查
just sg-test              # ast-grep 规则单测 (rule-tests)
just check-deprecated     # 一键扫描项目中已废弃 (@deprecated) 的依赖函数

# --- 测试与性能 ---
just test                 # 运行 Vitest 单元测试
just test-watch           # 单元测试 Watch 模式
just test-cov             # 单元测试覆盖率报告
just test-e2e             # 运行 E2E 端到端集成测试
just k6 smoke             # 运行 k6 smoke 场景负载基准测试
just k6 stress            # 运行 k6 stress 压力测试

# --- 数据库与 Better Auth ---
just db-gen               # 生成 Drizzle 迁移 SQL
just db-migrate           # 应用数据库迁移 (开发环境)
just db-deploy            # 应用数据库迁移 (生产环境)
just db-seed              # 填充数据库种子数据
just db-studio            # 启动 Drizzle Studio 可视化管理
just db-reset             # 重置数据库 (删除并重新迁移，慎用)
just ba-migrate           # 生成并应用 Better Auth 表结构变更
just ba-generate          # 依据 better-auth.ts 重新生成 Drizzle Schema

# --- 容器与实时服务 ---
just docker-up            # 启动全栈 Docker 容器集群 (API + 附属组件)
just docker-down          # 停止全栈 Docker 容器集群
just realtime             # 启动 Centrifugo 独立实时服务容器
just realtime-health      # 检查 Centrifugo 健康状态

# --- CLI 工具 (nest-commander) ---
just cmd --help           # 查看所有 CLI 指令 (直接执行 TS 源码)
just cmd route:list       # 列出全系统注册路由与端点
just cmd db:seed          # 通过 CLI 触发数据填充
just cmd jwt:secret       # 生成高强度 JWT / Auth 密钥
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
