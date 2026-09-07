# NestForge k6 压力测试与性能基准最佳实践

本项目基于业界主流的现代负载测试工具 **[Grafana k6](https://k6.io/)** 构建了极简、聚焦、零冗余的工程化性能测试套件。

---

## 📁 极简目录架构

```text
tests/k6/
├── config.js         # 环境变量、5大阶段负载模型 (profiles) 与 SLA 质量守门标准 (thresholds)
├── client.js         # 极简 HTTP Client、核心指标注册与 <50ms 快速鉴权预热
├── workflow.js       # 核心确定性业务流水线 (health -> users/me -> users?page=1... -> 可选注册)
├── reporter.js       # 基于 Tailwind CSS 4 + Alpine.js 的独立交互式 HTML 报告器
├── scenarios/        # 5 大经典压测场景入口 (纯粹声明 options + createRunner)
│   ├── smoke.js      # 1. 冒烟测试 (1 VU, 15s, 全链路验证)
│   ├── load.js       # 2. 常规负载测试 (20 VUs, ~2m, 聚焦高频读查)
│   ├── stress.js     # 3. 极限压力测试 (150 VUs, ~3.5m, 探测连接池与缓存拐点)
│   ├── spike.js      # 4. 突发流量脉冲测试 (180 VUs, ~1.5m, 验证限流与自愈弹性)
│   └── soak.js       # 5. 浸泡/耐力测试 (25 VUs, 5m+, 排查内存与连接泄漏)
├── main.js           # 统一调度总入口 (支持 -e SCENARIO=xxx)
└── README.md         # 本指南文档
```

---

## 🎯 5 大场景说明与使用时机

| 场景 | 虚拟用户 (VUs) | 典型时长 | 测试特性与目的 |
| :--- | :--- | :--- | :--- |
| **Smoke (冒烟)** | 1 VU | 15s | **CI/CD 门禁 / 本地极速自测**。全链路执行（含写注册），验证所有端点通畅、脚本无报错。 |
| **Load (负载)** | 20 VUs | ~2m | **常规发布前基准评估**。模拟常态流量，评估 P95 响应时延与 RPS 吞吐。 |
| **Stress (压力)** | 30 → 80 → 150 VUs | ~3.5m | **探测极限承载力与瓶颈**。阶梯加压，观察 Fastify、Drizzle、Postgres 连接池与 Redis 缓存拐点。 |
| **Spike (突刺)** | 10 → 180 VUs (10s内) | ~1.5m | **突发洪峰冲击与限流自愈**。验证 NestJS Throttler 保护与冲击退去后的恢复能力。 |
| **Soak (浸泡)** | 25 VUs (恒定) | 5m ~ 数小时 | **长周期稳定性与防泄漏**。检测内存泄漏 (Event Emitter/闭包)、Redis/DB 连接池泄漏。 |

---

## 🚀 快速开始与运行方式

### 方式 1：通过 `just` 快捷命令（推荐）

在运行压测前，请确保本地服务已启动并已灌入种子数据（`just dev` + `just db-seed`）：

```bash
# 1. 冒烟测试 (快速自测 / CI 校验)
just k6-smoke

# 2. 常规负载测试
just k6-load

# 3. 极限压力测试
just k6-stress

# 4. 突发流量脉冲测试
just k6-spike

# 5. 浸泡/耐力测试 (默认 5 分钟)
just k6-soak

# 6. 指定自定义目标环境与场景
just k6 load BASE_URL=http://staging.api.dev
```

### 方式 2：通过 Docker 容器化运行（免本地安装 k6）

若本地未安装 `k6` CLI，可直接利用 Docker 运行官方镜像：

```bash
# 容器化运行冒烟测试
just k6-docker smoke

# 容器化运行极限压测并指定目标主机
just k6-docker stress
```

> **注意 (Docker)**：Docker 容器默认通过 `host.docker.internal:4300` 访问宿主机服务。

### 方式 3：直接使用 `k6` CLI

```bash
# 执行指定场景
k6 run tests/k6/scenarios/smoke.js

# 通过环境变量切换综合入口
k6 run -e SCENARIO=stress -e BASE_URL=http://localhost:4300 tests/k6/main.js
```

---

## ⚙️ 环境变量与参数配置

可在命令行通过 `-e KEY=VALUE` 传入：

| 环境变量 | 默认值 | 描述说明 |
| :--- | :--- | :--- |
| `BASE_URL` | `http://localhost:4300` | 目标后端服务的基准地址 |
| `API_PREFIX` | `/v1` | 全局路由前缀 |
| `ADMIN_EMAIL` | `admin@nestforge.dev` | `setup()` 阶段用于预热 Token 的管理员账号 |
| `ADMIN_PASSWORD` | `admin123` | 管理员密码 |
| `SOAK_DURATION` | `5m` | 浸泡测试时长（支持 `10m`、`1h` 等） |
| `TIMEOUT` | `10s` | 单个 HTTP 请求超时时间 |

---

## 📊 质量守门 (Thresholds) 与测试报告

### 1. 自动化 SLA 门禁 (Thresholds)

k6 在执行过程中会自动校验预设的质量守门标准，未达标时测试将返回非 0 状态码：

- `http_req_failed`: `rate < 0.01`（HTTP 失败率低于 1%）
- `http_req_duration`: `p(95) < 800ms`, `p(99) < 1500ms`
- `checks`: `rate > 0.99`（业务断言成功率 > 99%）
- `flow_success_rate`: `rate > 0.99`（全链路事务完成率 > 99%）

### 2. 交互式 HTML 报告与历史归档

每次压测结束后，自动在本地生成基于 **Tailwind CSS 4 + Alpine.js** 的独立交互式 HTML 报告并永久归档：

- **历史归档报告**：`storage/logs/k6-reports/<scenario>-<YYYYMMDD-HHmmss>.html`
- **历史归档数据**：`storage/logs/k6-reports/<scenario>-<YYYYMMDD-HHmmss>.json`
- **最新快捷入口**：`storage/logs/k6-reports/latest.html`（或 `storage/logs/k6-summary.html`）
- **最新 JSON 数据**：`storage/logs/k6-reports/latest.json`
