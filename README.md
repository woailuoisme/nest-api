# nest-api <!-- rumdl-disable-line first-line-heading -->

现代、开箱即用的 NestJS 12 + Fastify 5 企业级后端脚手架，纯 ESM 架构。
集成 @nestjs/authentication 认证、Drizzle ORM、BullMQ 队列、Centrifugo 实时中枢、MQTT 5.0 物联网总线、
Meilisearch 检索、imgproxy 媒体处理、幂等与弹性治理，以及 Vitest 5 测试套件。

---

## 核心特性

- **认证与权限**：`@nestjs/authentication`（账号密码、用户名/邮箱 OTP/短信 OTP 登录、会话 Cookie、JWT + refresh、TOTP 两步验证、邮箱验证、找回密码、API Key、一次性登录令牌、管理员冒充）；角色 `SUPER_ADMIN / ADMIN / OPERATOR / USER`，授权由 `@nestjs/authorization` 域级 policy（`@Can()` / `@Can.Anyone()`）默认拒绝式判定。
- **实时通信**：Centrifugo 无状态中枢，WebSocket / SSE 双协议、模式匹配频道授权（`@ChannelAuth`）与 Presence 在线感知；Proxy 回调支持恒定时间密钥校验。
- **全文检索**：Laravel Scout 风格驱动抽象（Meilisearch / Noop 降级），`searchModel` 作为统一入口，BullMQ 异步同步索引。
- **工业物联网**：MQTT 5.0 总线，声明式 `@MqttSubscribe()` 路由、RPC 指令下发、遥测影子与设备仿真。
- **幂等与弹性**：`@Idempotent()` 配合 Drizzle 幂等存储（DB 时钟租约、CAS 抢占、单次重试预算）；出站 HTTP 具备全链路死线传播；`@nestjs/resilience` 预设覆盖超时 / 重试 / 熔断（支付通道显式禁自动重试）。
- **安全基线**：跨副本一致限流（Redis 原子 Lua，故障自动降级进程内）、CSRF（Fetch Metadata）、请求超时、gitleaks 凭据扫描、非 root + tini 运行。安全响应头与传输压缩交由边缘代理（Traefik / Nginx）承担，应用层不再重复处理。
- **媒体与存储**：imgproxy JIT 实时渲染与 HMAC-SHA256 签名、纯 JS 元数据探测、矢量二维码；`@nestjs/storage` 提供 local / memory / s3 磁盘与补偿性写入（`storeWithCompensation`）。
- **可观测性**：原生 Pino 单通道 stdout、OpenTelemetry 三信号（logs / metrics / traces）、`/livez` 与 `/readyz` 探针。
- **API 文档**：客户端 `/docs`、管理后台 `/docs/admin`、认证 `/docs/auth` 三份物理隔离的 Scalar UI。

---

## 技术栈

| 层次               | 选型                                                  |
| :----------------- | :---------------------------------------------------- |
| 运行时             | Bun ≥ 1.2 + Node ≥ 24，纯 ESM                         |
| 核心框架           | NestJS 12 + Fastify 5                                 |
| 持久层             | Drizzle ORM 1.0 RC（`@nestjs/drizzle` + node-postgres）+ PostgreSQL（原生 `uuidv7()` 主键） |
| 认证授权           | @nestjs/authentication 0.1                            |
| 缓存与队列         | Redis + BullMQ 6                                      |
| 实时 / 检索 / 物联 | Centrifugo / Meilisearch / MQTT 5.0                   |
| 校验与文档         | Zod 4 Standard Schema + OpenAPI 3.1（Scalar UI）      |
| 构建与质量         | SWC + oxlint + oxfmt + Gitleaks + Vitest 5 + Just     |

---

## 目录结构

```text
├── deploy/            # 交付编排：Centrifugo / Meilisearch / imgproxy / Mosquitto / otel-collector
├── docs/              # 专题文档（API、幂等、MQTT、支付、实时通信）
├── storage/           # 运行时数据（uploads 等，git 忽略）
├── tests/             # Vitest 单元 / E2E 测试与数据工厂
└── src/
    ├── common/        # 基础设施：auth、cache、http、idempotency、media、resilience、
    │                  # search、storage、mail、throttler、wechat、guards、filters、interceptors
    ├── config/        # Zod 环境变量校验（全 DSN 统一配置）
    ├── database/      # Drizzle 多文件 Schema、原生 DDL、种子与检索模型
    ├── commands/      # nest-commander CLI（route:list、db:seed、app:init、jwt:secret 等）
    ├── realtime/      # 实时中枢：Centrifugo 适配、频道鉴权、多协议路由
    ├── iot/           # MQTT 5.0 传输层、声明式订阅、遥测影子与指令 RPC
    ├── features/      # 业务特性层（client / admin / system）
    ├── jobs/          # 队列契约与消费者（mail、media、search、token-cleanup）
    ├── schedules/     # 集中式定时任务声明
    ├── setup/         # Fastify 插件、中间件管道、Pino 日志、OTel、Scalar 文档
    ├── bootstrap/     # 进程引导体（server / worker），仅由 CLI 调用
    ├── app.module.ts  # HTTP 主模块
    └── cli.ts         # 唯一启动前门（serve / worker / 一次性命令）
```

---

## 快速开始

### 前置要求

- Node.js ≥ 24 与 Bun ≥ 1.2
- [Just](https://github.com/casey/just)（`brew install just`）
- PostgreSQL 与 Redis 可达（连接由 `.env` 的 `DB_URL` / `REDIS_URL` 指定）

### 本地开发

```bash
cp .env.example .env
bun install

just migrate          # 应用迁移
just seed             # 灌入种子数据（全新库可用 just fresh 一步重建）

just dev                 # API + Worker 双进程，SWC 热更新
```

> `just dev` 与生产容器拓扑一致：两个进程共用同一份 `dist/`，日志以 `[app]` / `[worker]` 前缀区分，`Ctrl-C` 同时停止。

### 容器运行

```bash
just build               # 清空 dist 并执行 SWC 构建
docker compose up -d     # 仅 api + worker；依赖组件见 deploy/ 各自编排
```

镜像以 `tini` 为 PID 1、非 root 运行，`ENTRYPOINT` 固定为 `dist/cli.js`，进程类型由 `CMD`（`serve`）或编排器 args（`worker`）决定。

---

## 服务与控制台

| 服务              | 地址                               | 说明                                     |
| :---------------- | :--------------------------------- | :--------------------------------------- |
| 客户端 API 文档   | `http://localhost:4300/docs`       | 客户端公共业务接口与在线调试             |
| 管理后台 API 文档 | `http://localhost:4300/docs/admin` | 管理领域接口（`/v1/admin` 前缀）         |
| 认证 API 文档     | `http://localhost:4300/docs/auth`  | 注册/登录/令牌/2FA 端点参考              |
| 存活探针          | `http://localhost:4300/livez`      | 纯文本 `ok`，零外部 I/O                  |
| 就绪探针          | `http://localhost:4300/readyz`     | 检测 DB、Redis、实时、存储等依赖与停机态 |

> 文档面板由 `SWAGGER_ENABLED` 控制，生产可显式关闭。

---

## 认证与权限

执行 `just seed` 后装配初始账号：

| 角色          | 邮箱                   | 密码             | 说明                              |
| :------------ | :--------------------- | :--------------- | :-------------------------------- |
| `SUPER_ADMIN` | `admin@example.com`    | `admin123456`    | 全量管理与系统配置                |
| `OPERATOR`    | `operator@example.com` | `operator123456` | 常规业务运维与审计                |
| `USER`        | `user@nestforge.dev`   | `password123`    | 普通用户（另生成 100 位随机用户） |

- 前后台共用同一 `user` 主表，角色决定管理权限。
- 未声明 `@Can()` / `@Can.Anyone()` / `@Public()` 的路由一律拒绝（deny-by-default）。
- `/admin` 管理面由 `AdminPolicy` 按能力判定：SUPER_ADMIN 直通，ADMIN / OPERATOR 按能力细分。

```typescript
@Can(AdminPolicy, 'changeUserRole')          // 管理能力
@Can(UserPolicy, 'view', param('id'))      // 路由参数能力
@Can.Anyone()                                // 任意已登录用户（访客仍受认证拦截）
```

---

## 常用命令

```bash
# 运行与构建
just dev                  # API + Worker 双进程热更新
just build                # 生产构建（SWC → dist/）
just serve                # 运行已构建的 HTTP API
just worker               # 运行已构建的队列 Worker

# 质量门禁
just check                # 提交前完整检查 (fix + type + secret + i18n)
just type / lint / fix / fmt
just secret               # gitleaks 凭据扫描

# 测试
just test / watch / cov / e2e

# 数据库
just gen / migrate / seed / fresh / studio

# 工具与多语言
just i18n                 # catalog 键 / 占位符 / 复数形式对称性
just mail                 # MJML → Handlebars 邮件模板
just cmd <命令>           # 直接运行 TS CLI（如 just cmd route:list）
just cmd app:init         # 幂等初始化：密钥 / 迁移 / S3 桶
```

---

## 部署注意

1. **实时代理密钥**：生产环境配置 `REALTIME_URL` 时，`CENTRIFUGO_PROXY_SECRET`（≥16 字符）为必填，缺失将启动失败；须与 Centrifugo 侧静态头成对配置。
2. **反向代理信任**：`TRUST_PROXY` 默认 `false`。部署在网关之后时填写网关实际 CIDR（如 `172.16.0.0/12`），否则按 IP 限流与匿名幂等作用域会退化为代理地址；生产禁止 `true` 或全通配 CIDR。
3. **边缘职责**：安全响应头、gzip / brotli / zstd 压缩与连接排空由 Traefik / Nginx 等边缘层统一承担。
