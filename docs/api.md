
# RESTful API 接入指南

本文档面向所有接口调用方（Web、移动端、第三方系统与服务间集成），描述接入本 API 所需的地址、认证、请求头、响应结构、错误模型、分页查询、速率限制与版本演进策略。

所有接口遵循 REST 语义：请求与响应均为 `application/json`（编码 `UTF-8`），接口通过 URI 路径进行版本控制。

---

## 1. 快速开始与服务地址 (Quick Start & Endpoints)

### 1.1 快速开始 (Quick Start)

**第 1 步**：调用认证接口获取访问令牌。

```bash
curl -X POST https://api.example.com/v1/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"email":"user@example.com","password":"<your_password>"}'
```

**第 2 步**：携带令牌调用受保护资源。

```bash
curl https://api.example.com/v1/users/me \
  -H "Accept: application/json" \
  -H "Authorization: Bearer <your_access_token>"
```

各端点的完整参数、请求示例与响应结构，请在本参考文档中按标签（Tag）浏览；每个端点均提供可直接运行的示例。

### 1.2 服务地址 (Base URL)

| 环境                         | API Base URL                           | 说明                   |
| :--------------------------- | :------------------------------------- | :--------------------- |
| **测试环境 (Stage)** | `https://api.stage.example.com/v1` | 集成测试与验收         |
| **生产环境 (Prod)**  | `https://api.example.com/v1`       | 线上环境（强制 HTTPS） |

- 版本号位于路径首段：`/{version}/{resources}`，当前稳定版本为 `v1`。
- 生产环境仅接受 **HTTPS** 请求，请勿在生产环境使用明文 HTTP。
- 请求与响应统一使用 `application/json`，字符集固定为 `UTF-8`。

---

## 2. 数据格式与交互约定 (Data Conventions)

### 2.1 命名约定 (Naming)

- **资源路径**：复数名词、全小写短横线，不使用动词（如 `/{version}/{resources}`）。
- **Query 参数与 JSON 键名**：小驼峰（`camelCase`），例如 `createdAt`、`sortBy`、`pageSize`。
- **布尔字段**：统一使用 `is` / `has` / `can` 驼峰前缀或清晰布尔语义，例如 `isActive`、`hasAttachments`、`banned`、`emailVerified`。
- **枚举值**：全小写，多词用下划线分隔，例如 `"user"`、`"admin"`、`"active"`、`"in_progress"`（与 AGENTS.md §5.3 的示范一致）。

### 2.2 时间与数值精度 (Timestamp & Precision)

- **时间**：统一采用 ISO 8601 / RFC 3339 格式，**UTC 时区并以 `Z` 结尾**，例如 `"2026-08-25T14:28:10Z"`。不会返回无时区标记或裸数值形式的时间。
- **大整数**：超出 JavaScript 安全整数范围（大于 2^53 - 1）的数值，例如 64 位整型标识、雪花 ID，在 JSON 中**以字符串（`string`）形式传输**。请按字符串解析并存储，避免精度丢失。
- **金额**：以货币最小整数单位（如分 `cents`）表示，或采用定点字符串（如 `"199.99"`）；请勿使用浮点数参与金额计算。

### 2.3 空值与更新语义 (Nullability & Update Semantics)

- **空集合**：无数据或空列表时，字段一律返回 `[]`（空数组），不会返回 `null`，可直接安全遍历。
- **PATCH 局部更新三态语义**：
  - **字段缺省（不传该字段）**：保持原值不变；
  - **显式传递 `null`（`"field": null`）**：明确置空或解绑该字段；
  - **传递非空具体值**：覆盖更新为该值。

### 2.4 输入校验与失败反馈 (Validation)

所有输入在服务边界完成校验。校验失败时统一返回 `422 Unprocessable Entity`，并在响应的 `errors` 字段中按字段名归集失败原因，调用方可直接映射到表单控件（详见 [5.2 错误响应](#52-错误响应-error-response)）。

---

## 3. 认证与请求头 (Authentication & Headers)

### 3.1 认证方式 (Authentication)

除公开端点外，所有受保护请求必须携带 Bearer Token：

```http
Authorization: Bearer <your_access_token>
```

| 状态码               | 含义                                   | 调用方处理                                         |
| :------------------- | :------------------------------------- | :------------------------------------------------- |
| `401 Unauthorized` | 未携带凭证，或令牌已过期、失效、被撤销 | 使用刷新令牌换取新令牌后重试；刷新失败引导重新登录 |
| `403 Forbidden`    | 凭证有效，但无权访问该资源或执行该操作 | 不要重试；提示用户权限不足或联系管理员             |

**安全提示**：请仅在请求头中传递令牌，不要将令牌拼接到 URL、写入日志或落盘到客户端明文存储。

**令牌说明**：角色变更不影响已签发的访问令牌，续签后生效；需立即失效请调用登出/撤销接口。客户端不得解析令牌做权限判断，一切以 `403 Forbidden` 为准。

### 3.2 标准请求头 (Request Headers)

| 请求头                        | 必需 | 描述                                                     | 示例                                     |
| :---------------------------- | :--: | :------------------------------------------------------- | :--------------------------------------- |
| **`Content-Type`**    |  是  | 请求体媒体类型                                           | `application/json`                     |
| **`Accept`**          |  是  | 客户端期望的响应格式                                     | `application/json`                     |
| **`Authorization`**   | 条件 | 访问受保护资源的 Bearer Token                            | `Bearer eyJhbGci...`                   |
| **`x-request-id`**    |  否  | 全链路追踪 ID；未提供时由服务端生成，并在响应头回写      | `req_019572d4a6c878b18cf0`             |
| **`Idempotency-Key`** | 可选 | 非幂等写操作的去重键（36 字符 UUID）；携带则去重并回放首次响应，未携带行为不变 | `019572d4-a6c8-78b1-8cf0-281b94c032a1` |

> 本 API 只使用 `application/json`：不实现 415/406 内容协商——`Accept` 与 `Content-Type` 不匹配不会单独报错，请求体结构有问题时仍返回 400。

### 3.3 幂等请求 (Idempotency)

> **已接线（探测模式）。** 服务端已挂载幂等中间件：携带 `Idempotency-Key` 的写请求会按该键去重、并在重复提交时回放首次响应；**未携带时行为与从前完全一致**（不强制要求，避免破坏既有客户端与渠道回调）。以下语义适用于携带该头的请求。

对创建类、支付类等非幂等写操作，建议携带 `Idempotency-Key`：

- **Key 取值**：必须为 36 字符 UUID（服务端按长度校验），推荐 UUIDv7。
- **重试保持稳定**：同一业务意图的多次重试必须复用同一个 Key；每次重试生成新 Key 将失去去重保护。
- **服务端行为**：
  - 相同 Key 的并发请求串行化：只有首个请求真正执行，其余等待并回放同一结果；
  - 回放包含首次响应的状态码、响应体与可回放响应头（默认排除 `Set-Cookie`）；
  - 处理器返回错误的请求不写入缓存，可用同一 Key 安全重试；
  - Key 默认保留 30 分钟，可通过中间件配置调整；
  - 幂等作用域按认证用户 / 凭据 / 会话 / 客户端标识 / IP+UA 隔离，不同主体使用相同 Key 互不影响。

---

## 4. HTTP 方法与状态码 (HTTP Methods & Status Codes)

### 4.1 HTTP 动词语义

|         方法         | 语义                         |     幂等性     |                    成功返回                    | 典型场景                       |
| :------------------: | :--------------------------- | :------------: | :---------------------------------------------: | :----------------------------- |
|  **`GET`**  | 获取单个资源或列表           |    幂等    |                   `200 OK`                   | 读取详情、分页查询             |
|  **`POST`**  | 创建新资源或执行非 CRUD 操作 |   非幂等   | `201 Created` / `200 OK` | 创建实体、提交认证 |
|  **`PUT`**  | 全量覆盖替换目标资源         |    幂等    |                   `200 OK`                   | 完整替换目标配置               |
| **`PATCH`** | 局部修改目标资源属性         | 视具体端点而定 |                   `200 OK`                   | 局部更新字段、变更状态         |
| **`DELETE`** | 销毁或注销目标资源           |    幂等    |         `204 No Content` / `200 OK`         | 删除资源、解绑关联             |

### 4.2 响应状态码速查

| 状态码       | `code` 字段 / 状态语义        | 说明                        |
| :-------- | :---------------------- | :------------------------ |
| **`200`** | `OK`                    | 请求处理成功                    |
| **`201`** | `CREATED`               | 资源创建成功                    |
| **`204`** | `NO_CONTENT`            | 请求成功，无返回数据体（0 字节）         |
| **`400`** | `BAD_REQUEST`           | 请求格式无效、缺少必填参数或语法错误        |
| **`401`** | `AUTH_TOKEN_INVALID` 等  | 未携带凭证，或令牌无效、已过期、已被撤销      |
| **`403`** | `FORBIDDEN` 等           | 凭证有效但无权执行该操作（权限不足或账号受限）   |
| **`404`** | `NOT_FOUND`             | 请求的资源或 URI 不存在            |
| **`405`** | `METHOD_NOT_ALLOWED`    | 请求的 HTTP 方法不受支持          |
| **`409`** | `CONFLICT` 等            | 资源状态冲突（如唯一键重复）            |
| **`413`** | `REQUEST_TOO_LARGE`     | 请求体超过服务端上限（普通请求 1 MiB；multipart 上传按 `MEDIA_MAX_FILE_SIZE`） |
| **`422`** | `VALIDATION_FAILED` 等   | 请求体字段语义或参数验证规则校验失败        |
| **`429`** | `RATE_LIMITED`          | 请求频率超出速率配额限制              |
| **`500`** | `INTERNAL_SERVER_ERROR` | 服务器内部异常，未捕获错误统一转为通用提示     |
| **`504`** | `GATEWAY_TIMEOUT`       | 请求处理超时（上游数据库或依赖未在时限内响应） |

> 关于第二列：2xx 的成功响应**不含 `code` 字段**（成功响应直接返回业务对象本身，见 5.1），该列对这些行给出的是状态语义名；4xx 与 5xx 行给出的是错误响应体里 `code` 字段的字面取值，标为「等」表示该状态码对应多个具体错误码。

---

## 5. 响应格式与错误处理 (Response Structure & Error Handling)

接口响应遵循简洁一致的契约：**仅分页列表**使用 `{"items": [...], "meta": {...}}` 信封，其余成功响应一律直接返回业务对象本身，不含 `success`、`code`、`message` 等外层包装。

### 5.1 成功响应 (Success Response)

#### 1. 分页列表响应

所有分页列表统一包裹在 `items` 与 `meta` 中：

```json
{
  "items": [
    {
      "id": "<resource_id>",
      "<attribute>": "<value>"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

空列表同样保持信封结构，`items` 固定为 `[]`：

```json
{
  "items": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

#### 2. 单资源与操作结果

查询、创建、更新等非分页响应直接返回业务对象：

```json
{
  "id": "<resource_id>",
  "<attribute>": "<value>"
}
```

#### 3. 无返回数据体 (`204 No Content`)

删除、登出、修改密码等无返回内容的操作统一返回 `204 No Content`，响应体为空（0 字节），请勿解析响应体。

### 5.2 错误响应 (Error Response)

所有错误响应统一采用扁平根级结构，包含机器可读的 `code` 与人类可读的 `message` 描述信息。

#### 1. 通用业务与客户端错误 (`400` / `401` / `403` / `404` / `409`)

```json
{
  "code": "<MACHINE_READABLE_ERROR_CODE>",
  "message": "<human_readable_error_description>"
}
```

#### 2. 字段级校验失败 (`422 Unprocessable Entity`)

按字段键归集错误文案数组，可直接用于表单控件报错：

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Validation failed",
  "errors": {
    "teamName": [
      "The team name must be a string.",
      "The team name must be at least 1 characters."
    ],
    "authorization.role": [
      "The selected authorization.role is invalid."
    ],
    "users.0.email": [
      "The users.0.email field is required."
    ],
    "users.2.email": [
      "The users.2.email must be a valid email address."
    ]
  }
}
```

#### 3. 服务器内部异常 (`500 Internal Server Error`)

```json
{
    "code": "INTERNAL_SERVER_ERROR",
    "message": "An unexpected error occurred"
}
```

#### 4. 追踪与重试

- 每次响应的 `x-request-id` 响应头唯一标识该次请求，请在反馈问题时一并提供；
- 生产环境不会返回堆栈信息、源码路径或数据库错误细节；
- `429` 与 `5xx` 可重试，请遵循 [7. 速率限制与重试策略](#7-速率限制与重试策略-rate-limiting--retries) 中的退避建议；
- `4xx` 中的参数、权限与状态冲突类错误，请在修正请求后重试。

---

## 6. 分页、过滤与排序 (Pagination, Filtering & Sorting)

分页列表统一采用 **Offset 偏移分页**：通过 `page` 与 `pageSize` 指定位置与页大小，响应中的 `meta.total` 与 `meta.totalPages` 可用于渲染分页器。

### 6.1 请求与响应

- **请求参数**：`page`（默认 `1`）、`pageSize`（默认 `20`，最大 `100`）。
- **响应结构**：

```json
{
  "items": [
    { "id": "<resource_id>", "<attribute>": "<value>" }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### 6.2 过滤、排序与检索

查询串遵循 spatie/laravel-query-builder v7 的约定。

#### 过滤 (filter)

- 单字段：`?filter[<field>]=<value>`；不同字段之间为 AND
- 多值（OR）：`?filter[<field>]=<v1>,<v2>`
- 匹配语义按字段声明：文本字段默认模糊匹配（不区分大小写，`LIKE %value%`），ID / 枚举 / 布尔为精确匹配（`1`、`0`、`true`、`false` 按布尔处理）
- 空值忽略：`?filter[<field>]=` 等同不传该条件
- 运算符过滤：`?filter[<field]>=<op><value>`，`op` 取 `>`、`>=`、`<`、`<=`、`<>`，如 `?filter[salary]=>3000`
- 未声明的可过滤字段返回 `400 BAD_REQUEST`

#### 排序 (sort)

- 升序 `?sort=<field>`；降序 `?sort=-<field>`；复合 `?sort=-<field1>,<field2>`
- 未声明的排序字段返回 `400 BAD_REQUEST`；服务端始终提供确定性默认排序，分页遍历不会出现数据漂移

#### 检索与关联

- 全局搜索：`?search=<keyword>`（在核心可检索列执行模糊匹配）
- 关联预加载：`?include=<relation1>,<relation2>`
- 稀疏字段集：`?fields[<resource>]=<field1>,<field2>`（精简响应体积）

#### 综合请求示例

```http
GET /{version}/{resources}?filter[status]=active&filter[role]=user,admin&filter[created_at]=>2026-01-01&sort=-created_at&include=<relation>&fields[<resource>]=id,created_at&page=1&pageSize=20
```

---

## 7. 速率限制与重试策略 (Rate Limiting & Retries)

接口在网关与中间件层实施多级配额控制：

- **已认证用户**：标准业务并发配额；
- **敏感认证端点**：防暴力破解的严格限制。

支付与实时回调端点**不做限流**：渠道服务端的阶梯重试是合法流量，限流会误伤、极端情况下导致漏单；这两个端点依靠签名校验（渠道验签 / HMAC）与幂等防重放抵御滥用。

超出配额时返回 `429 Too Many Requests`，并通过标准响应头给出配额状态：

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1756137600
```

**调用方建议**：

- 优先遵循 `Retry-After` 指定的等待秒数；
- 采用指数退避并加入随机抖动，避免同一时刻集中重试形成二次冲击；
- 写操作重试务必复用同一个 `Idempotency-Key`；
- 对 `429`、`5xx` 与网络超时进行退避重试；`4xx` 业务错误不应重试。

---

## 8. 版本演进 (Versioning)

接口通过向前兼容的方式演进，同一大版本内不会引入破坏性变更：

- **非破坏性扩展**：新增可选入参、在响应中新增只读字段、新增专用端点；
- **破坏性变更**：修改字段类型、将可选参数改为必填、删除或改名既有字段、变更既有成功状态码——此类变更仅通过新版本（如 `/v2`）提供。

请调用方对响应中的新增字段保持宽容（忽略未知字段），以平滑获取新能力。
