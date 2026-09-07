# API 设计规范与接入指南

NestForge 遵循现代工业级 **RESTful API 设计原则**，为系统提供具备高可预测性、标准 HTTP 动词语义、统一 JSON 响应包封、双轨制分页与全链路追踪的通信协议。

---

## 1. 概述与服务地址 (Overview & Endpoints)

API 统一采用 **URI 路径版本控制**，数据传输格式为 `application/json`（编码 `UTF-8`）。

| 环境                         | API Base URL                              | 描述                      |
| :--------------------------- | :---------------------------------------- | :------------------------ |
| **本地开发 (Dev)**     | `http://localhost:4300/v1`              | 本地开发与测试调试        |
| **测试环境 (Staging)** | `https://staging-api.yourdomain.com/v1` | 集成测试与 QA 验收        |
| **生产环境 (Prod)**    | `https://api.yourdomain.com/v1`         | 线上生产环境 (强制 HTTPS) |

---

## 2. 身份认证与请求头 (Authentication & Request Headers)

### 2.1 认证方式

除公开端点外，所有 API 请求必须在 `Authorization` 头中携带 Bearer JWT Token：

```http
Authorization: Bearer <your_access_token>
```

### 2.2 标准请求头

| 请求头                        | 必需 | 描述                                                  | 示例                           |
| :---------------------------- | :--: | :---------------------------------------------------- | :----------------------------- |
| **`Content-Type`**    |  ✅  | 请求体媒体类型                                        | `application/json`           |
| **`Accept`**          |  ✅  | 客户端期望的响应格式                                  | `application/json`           |
| **`Authorization`**   | 条件 | 访问受保护资源的 Bearer Token                         | `Bearer eyJhbGci...`         |
| **`x-request-id`**    |  ❌  | 全链路追踪 ID（若未提供，网关自动生成并回写响应头）   | `req_01j6k8y9z0a1b2`         |
| **`Idempotency-Key`** |  ❌  | 非幂等写操作防重放防并发唯一键（推荐 ULID / UUID v7） | `01J6K8Y9Z0A1B2C3D4E5F6G7H8` |

---

## 3. HTTP 方法与状态码 (HTTP Methods & Status Codes)

### 3.1 HTTP 动词语义

|         方法         | 语义                         |     幂等性     |            成功返回            | 典型场景                  |
| :------------------: | :--------------------------- | :------------: | :-----------------------------: | :------------------------ |
|  **`GET`**  | 获取单个资源或集合           |    ✅ 幂等    |           `200 OK`           | 读取用户、分页查询列表    |
|  **`POST`**  | 创建新资源或执行非 CRUD 操作 |   ❌ 非幂等   |  `201 Created` / `200 OK`  | 用户注册、登录、重置密码  |
|  **`PUT`**  | 全量覆盖替换目标资源         |    ✅ 幂等    |           `200 OK`           | 完整更新用户画像配置      |
| **`PATCH`** | 局部修改目标资源指定属性     | ❌/✅ 取决实现 |           `200 OK`           | 更新用户邮箱、修改状态    |
| **`DELETE`** | 销毁或注销目标资源           |    ✅ 幂等    | `200 OK` / `204 No Content` | 删除文章、解绑 OAuth 账号 |

### 3.2 响应状态码速查

|      状态码      | 对应枚举 Code             | 说明                                      |
| :---------------: | :------------------------ | :---------------------------------------- |
| **`200`** | `OK`                    | 请求处理成功                              |
| **`201`** | `CREATED`               | 资源创建成功                              |
| **`204`** | `NO_CONTENT`            | 请求成功，无返回数据体                    |
| **`400`** | `BAD_REQUEST`           | 请求格式无效、缺少必填参数或约束校验失败  |
| **`401`** | `UNAUTHORIZED`          | 未提供身份凭证或 Token 已过期失效         |
| **`403`** | `FORBIDDEN`             | 凭证有效但无权执行该操作（角色/权限不足） |
| **`404`** | `NOT_FOUND`             | 请求的资源或 URI 不存在                   |
| **`409`** | `CONFLICT`              | 资源状态冲突（如唯一键重复、邮箱已注册）  |
| **`422`** | `UNPROCESSABLE_ENTITY`  | 请求体字段语义或格式校验失败              |
| **`429`** | `TOO_MANY_REQUESTS`     | 请求频率超出速率配额限制                  |
| **`500`** | `INTERNAL_SERVER_ERROR` | 服务器内部未知异常                        |

---

## 4. 响应格式与错误处理 (Response Structure & Error Handling)

所有 JSON 接口均遵循纯正工业级 RESTful 响应规范（对齐 Stripe / Google Cloud AIP / JSON:API 标准），彻底废除冗余的 `success`、`code`、`message` 外层包装，由 HTTP 状态码表征传输状态，Body 聚焦业务数据与结构化错误。

### 4.1 成功响应 (Success Response)

- **单个资源 / 业务对象**：

```json
{
  "data": {
    "id": "01j6k8y9z0a1b2c3d4e5f6g7h8",
    "name": "Jane Doe",
    "email": "jane.doe@example.com"
  }
}
```

- **空响应或无返回值操作 (204 No Content)**：

对于资源删除（如 `DELETE /users/:id`）、用户注销（`POST /auth/logout`）、密码重置邮件发送（`POST /auth/forgot-password`）等无业务载荷返回的操作，系统统一返回 `HTTP 204 No Content`，响应体为空（0 字节，无 `Content-Type` 与 Body 包裹）。

### 4.2 错误响应 (Error Response)

所有异常与校验失败均由根级 `error` 命名空间包裹：

- **通用业务/资源错误（如 404 / 401 / 403 / 409）**：

```json
{
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "User not found"
  }
}
```

- **表单与字段级参数校验失败（422 Unprocessable Entity）**：

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "fields": {
      "email": [
        "email must be a valid email address"
      ],
      "password": [
        "password must be longer than or equal to 8 characters"
      ]
    }
  }
}
```

- **内部异常与调试信息（仅在非生产环境且 `APP_DEBUG=true` 时出现）**：

```json
{
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "message": "Unable to connect to upstream service",
    "details": {
      "exception": "ConnectionRefusedException",
      "stack": [
        "OrderService.ts:88",
        "OrderController.ts:45"
      ]
    }
  }
}
```

> 🛡️ **生产环境脱敏与全链路追踪**：
>
> 1. 全链路请求追踪 ID 统一通过 HTTP 响应头 `x-request-id` 返回，不污染 JSON 响应体。
> 2. 当 `APP_DEBUG=false`（生产环境必须为 false）时，系统严格脱敏，不输出 `details` 对象（屏蔽 `exception` 与 `stack`），内部未捕获异常的 `message` 统一转为标准文案，防止泄露内部系统细节。

### 4.3 数据库约束自动转译

|    数据库错误码    | 约束类型                                       |   转译 HTTP 状态   | 业务响应 Message 示例              |
| :-----------------: | :--------------------------------------------- | :-----------------: | :--------------------------------- |
| **`23505`** | 唯一键冲突 (`unique_violation`)              |  `409 CONFLICT`  | 数据已存在，请勿重复操作           |
| **`23503`** | 外键引用失效 (`foreign_key_violation`)       | `400 BAD_REQUEST` | 关联引用的目标数据不存在或无法关联 |
| **`23502`** | 必填字段缺失 (`not_null_violation`)          | `400 BAD_REQUEST` | 缺少必填的数据字段                 |
| **`22P02`** | 数据类型无效 (`invalid_text_representation`) | `400 BAD_REQUEST` | 数据格式或参数类型无效             |

---

## 5. 分页与查询规范 (Pagination & Querying)

NestForge 提供双轨制分页架构：管理表格默认采用 **Offset 偏移分页**，海量流式数据采用 **Cursor 游标分页**。

### 5.1 模式 A：标准 Offset 偏移分页 (管理端默认)

- **请求参数**：`page`（默认 `1`）、`pageSize`（默认 `20`，最大 `100`）。
- **响应结构**（`data` 数组与 `meta` 同级置于根节点）：

```json
{
  "data": [
    { "id": "01j6k8y9z0a1b2c3d4", "name": "Jane Doe" }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### 5.2 模式 B：工业级 Cursor 游标分页 (海量日志/流式数据)

- **请求参数**：`cursor`（上一次响应中的 `nextCursor` 游标）、`pageSize`（默认 `20`）。
- **响应结构**（对齐 Stripe 极简游标契约，天然适配 TanStack `useInfiniteQuery`）：

```json
{
  "data": [
    { "id": "log_01j6k8y9z0", "action": "user.login", "createdAt": "2026-08-25T14:28:10.000Z" }
  ],
  "meta": {
    "hasMore": true,
    "nextCursor": "log_01j6k8y9z0a1b9",
    "prevCursor": "log_01j6k8y9z0"
  }
}
```

### 5.3 查询过滤、排序与高级检索规范 (Spatie Query Builder 规范)

NestForge 采用业界领先的 **Laravel Spatie / JSON:API 标准查询契约**。底网关通过 `qs` 解析器原生支持嵌套括号对象与逗号数组。

#### 1. 字段过滤 (`filter[...]`)

- **精确匹配**：`?filter[status]=ACTIVE`
- **多值匹配 (IN 查询，逗号分隔)**：`?filter[role]=ADMIN,MANAGER`
- **区间/范围过滤**：`?filter[createdAfter]=2026-01-01`
- **多条件组合**：`?filter[role]=ADMIN&filter[status]=ACTIVE`

#### 2. 紧凑链式排序 (`sort`)

- **升序 (ASC)**：`?sort=name`
- **降序 (DESC，前缀 `-`)**：`?sort=-createdAt`
- **多字段复合排序 (逗号分隔)**：`?sort=-createdAt,name`（先按创建时间倒序，再按姓名升序）

#### 3. 全局模糊搜索 (`search`)

- **关键字多字段匹配**：`?search=John`（服务端在姓名、邮箱、手机号等多个核心列执行模糊检索）

#### 4. 关联预加载 (`include`) 与 字段投影 (`fields[...]`)

- **关联加载**：`?include=profile,roles`（预加载指定关联实体，避免 N+1 查询）
- **稀疏字段集**：`?fields[users]=id,name,email`（精简传输体积，仅返回客户端所需列）

#### 5. 综合请求示例 (Full Example)

```http
GET /v1/users?page=1&pageSize=20&search=Alex&filter[role]=ADMIN,MANAGER&filter[status]=ACTIVE&sort=-createdAt,name&include=profile
```

---

## 6. 实时流式传输规范 (Server-Sent Events / SSE Streaming)

对于 AI 大模型生成、长任务进度跟踪与实时事件推送，NestForge 原生支持符合 **OpenAI / W3C 标准的 SSE 流式协议**（`text/event-stream`）。

### 6.1 流式接口设计规范

- **请求头**：`Accept: text/event-stream`
- **响应头**：

  ```http
  Content-Type: text/event-stream; charset=utf-8
  Cache-Control: no-cache, no-transform
  Connection: keep-alive
  x-request-id: req_01j6k8y9z0a1b2
  ```

- **服务端实现约定**：使用 `@BypassTransform()` 装饰器绕过全局 JSON 包封拦截器，直接向客户端推送原始数据块（Chunks）。

### 6.2 数据块传输协议 (OpenAI-compatible Event Format)

每个数据块以 `data:` 为前缀，末尾追加双换行 `\n\n`；传输结束时发送标准的 `data: [DONE]\n\n` 终止符：

```http
data: {"id":"chunk_01","event":"message","delta":"Hello"}

data: {"id":"chunk_02","event":"message","delta":" world"}

data: {"id":"chunk_03","event":"message","delta":"!"}

data: [DONE]

```

---

## 7. 速率限制 (Rate Limiting)

API 在网关层根据客户端 IP 与用户凭据实施配额控制：

- **未认证 IP**：每分钟限制 `60` 次请求。
- **已认证用户**：每用户每分钟限制 `120` 次请求。
- **敏感认证接口**（如 `/auth/login`）：每分钟限制 `5` 次。

超限返回 `429 TOO_MANY_REQUESTS`，并通过响应头回传状态：

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1756137600
```
