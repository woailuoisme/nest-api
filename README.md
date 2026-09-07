# NestForge

NestForge 是一个现代、开箱即用的 NestJS 企业级后端脚手架。
集成完整认证与授权 (RBAC + OAuth)、Drizzle ORM、BullMQ 异步队列、Mailpit 邮件测试、
Pino 结构化日志、Prometheus 监控指标及 Vitest 测试环境。

## ✨ 核心特性

- 🔐 **认证与授权**：注册/登录、JWT 刷新 Token、OAuth (Google)、邮箱验证与重置密码
- 👥 **权限控制**：基于角色的访问控制 (RBAC) 与细粒度权限校验 (`@Roles()`, `@Permissions()`)
- 🛡️ **安全防护**：Helmet、CORS、Rate Limiting、Zod 数据校验与响应字段过滤
- 🗄️ **持久化与缓存**：Drizzle ORM + PostgreSQL、Redis 缓存与 BullMQ 任务队列
- 📨 **邮件系统**：异步队列处理，开发环境集成 Mailpit 本地测试
- 📄 **自动 API 文档**：Swagger 实时交互文档 (`/docs`)
- 🪵 **可观测性**：Pino 结构化日志、Terminus 健康检查 (`/health`)、Prometheus 指标 (`/metrics`)
- 🛠️ **开发者体验**：Just 任务自动化、Biome 校验/格式化、Vitest 快速单测/集成测试

## 🧱 技术栈

| 图层 | 技术 |
|---|---|
| 框架 | NestJS (TypeScript) |
| ORM / 数据库 | Drizzle + PostgreSQL |
| 缓存 / 队列 | Redis + BullMQ |
| 认证 | JWT + Passport |
| 校验 / 规范 | Zod + Biome + rumdl |
| API 文档 | Swagger |
| 邮件服务 | Mailpit (Dev) / SMTP |
| 测试框架 | Vitest |
| 任务管理 | Just |

## 📁 目录结构

```text
.
├── drizzle/       # Drizzle 迁移文件
├── storage/       # 运行时数据 (cache, logs, tmp, uploads)
├── tests/         # Vitest 单元测试与 E2E 测试
└── src/
    ├── common/        # 全局 Filter、Guard、Interceptor、Pipe、Decorator、Storage
    ├── config/        # 强类型环境变量与配置校验 (Zod)
    ├── database/      # Drizzle ORM、Redis 与 BullMQ 配置
    ├── commands/      # Nest Commander CLI 命令
    ├── queues/        # 异步队列任务与处理器 (Mail, TokenCleanup 等)
    ├── schedules/     # 定时任务调度器
    ├── setup/         # Fastify 插件、中间件与可观测性
    └── modules/       # 业务功能模块
        ├── auth/      # 认证 (JWT, Google OAuth, Guards, Strategies)
        ├── health/    # 健康检查 (Terminus)
        ├── metrics/   # 监控指标 (Prometheus)
        └── users/     # 用户管理 (CRUD, Avatar, RBAC)
```

## 🚀 快速开始

### 前置要求

- Node.js 24+ & Bun (≥ 1.2)
- Docker 与 Docker Compose

### 启动服务 (推荐 Docker)

```bash
# 复制环境变量配置
cp .env.example .env

# 启动依赖服务 (PostgreSQL, Redis, Mailpit)
just db-up

# 执行数据库迁移与种子数据
just db-migrate
just db-seed

# 启动开发服务器
just dev
```

服务启动后：

- **API Swagger 文档**: `http://localhost:4300/docs`
- **Mailpit 邮件测试控制台**: `http://localhost:8025`

### 常用命令 (Justfile)

```bash
just dev          # 启动开发模式 (Watch & SWC)
just check        # 完整代码检查 (Lint + Typecheck + Test)
just fix          # 自动修复 Lint 与 Markdown 格式
just test         # 运行单元测试
just test-e2e     # 运行 E2E 测试
just cmd --help   # 运行 CLI 命令工具
```

## 🔑 认证与权限

### 测试账号 (Seed Data)

| 邮箱 | 密码 | 角色 |
|---|---|---|
| `admin@nestforge.dev` | `admin123` | ADMIN |
| `manager@nestforge.dev` | `manager123` | MANAGER |
| `user@nestforge.dev` | `user1234` | USER |

### 角色与细粒度权限

系统支持按角色 (`ADMIN`, `MANAGER`, `USER`) 和细粒度动作权限进行控制：

| 权限标识 | ADMIN | MANAGER | USER |
|---|:---:|:---:|:---:|
| `user:create` | ✅ | ❌ | ❌ |
| `user:read` | ✅ | ✅ | ✅ |
| `user:update` | ✅ | ✅ | ❌ |
| `user:delete` | ✅ | ❌ | ❌ |
| `report:read` | ✅ | ✅ | ❌ |

路由示例：`@Permissions(Permission.UserCreate)` 或 `@Roles(Role.ADMIN)`
