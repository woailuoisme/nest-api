# RESTful API 设计规范与接入指南

本规范遵循现代工业级 **RESTful API 设计原则** 与权威接口架构规范，为前后端通信及微服务间集成提供具备高可预测性、标准 HTTP 动词语义、统一响应包封、严格边界校验、原子幂等保障与全链路追踪的通信标准。

---

## 1. 概述与服务地址 (Overview & Endpoints)

API 统一采用 **URI 路径版本控制**，传输格式固定为 `application/json`（编码 `UTF-8`）。

| 环境                         | API Base URL                              | 描述                      |
| :--------------------------- | :---------------------------------------- | :------------------------ |
| **本地开发 (Dev)**     | `http://localhost:{port}/v1`              | 本地开发与联调测试        |
| **测试环境 (Staging)** | `https://staging-api.example.com/v1`      | 集成测试与 QA 验收        |
| **生产环境 (Prod)**    | `https://api.example.com/v1`              | 线上生产环境 (强制 HTTPS) |

> 💡 **实时与流式传输协议规范**：关于 Server-Sent Events 流式传输、WebSocket 实时通信及 MQTT 消息总线，请参阅独立的专用协议文档：
> - [Server-Sent Events (SSE) 协议规范](file:///Users/seaside/Projects/go/fiber-sqlc/openapi/md/sse.md)
> - [WebSocket 实时通信协议规范](file:///Users/seaside/Projects/go/fiber-sqlc/openapi/md/websocket.md)
> - [MQTT 物联网通信协议规范](file:///Users/seaside/Projects/go/fiber-sqlc/openapi/md/mqtt.md)

---

## 2. 核心设计原则 (Core Principles)

接口是跨服务、前后端之间最持久的公共契约。“好的接口让正确的使用变得显而易见，让错误的使用变得极度困难。”

### 2.1 契约优先 (Contract First)

在编写具体业务实现之前，必须先确立接口协议与类型契约（OpenAPI / Schemas）。契约即规格，业务实现必须无条件服从契约，严禁让外部接口沦为内部实现细节的副产品。

### 2.2 海勒姆定律防范 (Hyrum's Law Defense)

> **海勒姆定律 (Hyrum's Law)**：当一个 API 拥有足够多的调用方时，系统所有可被观察到的行为（包括未提及的细微表现、错误文案格式、字段返回顺序、网络时延等），都会被依赖方作为事实契约予以依赖。

- **审慎暴露，杜绝实现泄漏**：对外暴露的每一个响应字段和行为都是长期的维护承诺。严禁将底层数据库主键（如自增 ID）、内部存储结构细节、第三方原样响应或框架异常堆栈直接透传。
- **预留演进路径**：所有公开字段一旦发布，不得随意更改其行为或变更语义。设计阶段即应制定弃用方案。

### 2.3 增量扩展优于破坏性修改 (Prefer Addition Over Modification)

遵循 **单一版本演进原则 (The One-Version Rule)**，接口通过向前兼容的方式演化：
- ✅ **推荐（非破坏性扩展）**：新增可选入参字段、在响应中新增只读属性、提供全新的专用端点；
- ❌ **严禁（破坏性变更）**：修改现有字段数据类型、将已有可选字段提升为必填、删除正在使用的字段、变更已有字段名或改变既有成功 HTTP 状态码。

#### 接口平滑退役标准 (RFC 8594 Sunset & Deprecation)

确需废弃端点或字段时，统一通过 RFC 8594 标准响应头提前通告调用方：
```http
Deprecation: @1756137600
Sunset: Wed, 11 Nov 2026 00:00:00 GMT
Link: <https://api.example.com/v2/{resources}>; rel="successor-version"
```

### 2.4 严格系统边界校验 (Validate at Boundaries)
- **边界强校验**：所有外部用户输入、表单提交、环境配置及**第三方服务响应与 Webhook 回调**一律视为不可信数据（Untrusted Data）。必须在 HTTP 接入层边界执行严格校验，未通过统一返回 `422 Unprocessable Entity`。
- **内部代码互信**：一旦请求通过边界校验进入内部领域层，业务逻辑即完全信任强类型数据的合法性，严禁在内部各层之间重复散落浅层防御性检查。

### 2.5 输入与输出严格解耦 (Input/Output Separation)
- **Input DTO**：仅包含调用方需提供的业务输入，附带参数清洗（`Normalize`）与校验规则；
- **Output Resource**：仅包含允许暴露给客户端的实体投影与派生字段，严禁直接暴露底层持久化模型；
- **实体防遍历**：对外暴露的业务实体主键统一优先使用单调递增、高毫秒精度的 **RFC 9562 UUIDv7** 标准。

### 2.6 命名、时间与数值规范 (Naming, Timestamp & Precision)
- **命名约定**：
  - REST 端点：复数名词、全小写短横线，禁止动词（如 `/{version}/{resources}`）；
  - Query 参数与 JSON 键名：小驼峰（`camelCase`，如 `createdAt`, `sortBy`）；
  - 布尔字段：`is` / `has` / `can` 前缀（如 `isActive`, `hasAttachments`）；
  - 枚举值：全大写下划线（`UPPER_SNAKE`，如 `"ACTIVE"`, `"IN_PROGRESS"`）。
- **时间标准**：统一遵循 **ISO 8601 / RFC 3339** 格式，强制采用 **UTC 时区并以 `Z` 结尾**（如 `"2026-08-25T14:28:10Z"`），严禁输出无时区或无格式的裸数值。
- **数值与精度安全**：
  - 超出 JavaScript 安全整数范围（> 2^53 - 1，如 64 位整型 ID、雪花 ID）的数值，在 JSON 传输时**必须序列化为字符串（`string`）**；
  - 货币金额推荐以货币最小整数单位（如分 `cents`）表示，或采用定点字符串（如 `"199.99"`），杜绝浮点数精度截断。

### 2.7 零值保底与更新语义 (Nullability & Update Semantics)
- **集合零值保底（严禁 null 数组）**：无数据或空列表时，服务端必须返回 `[]`（空数组），**绝对禁止返回 `null`**，杜绝前端 `.map()` 空指针崩溃。
- **PATCH 局部更新三态语义**：
  - **字段缺省 (Omitted)**：保持既有原值不变；
  - **显式传递 `null` (`"field": null`)**：明确置空或解绑该字段；
  - **传递非空具体值**：覆盖更新为该值。

---

## 3. 认证、请求头与并发控制 (Authentication, Headers & Concurrency)

### 3.1 认证方式

除公开端点外，所有受保护请求必须在 `Authorization` 请求头中携带 Bearer Token：
```http
Authorization: Bearer <your_access_token>
```

### 3.2 标准请求头

| 请求头                        | 必需 | 描述                                                  | 示例                           |
| :---------------------------- | :--: | :---------------------------------------------------- | :----------------------------- |
| **`Content-Type`**    |  ✅  | 请求体媒体类型                                        | `application/json`           |
| **`Accept`**          |  ✅  | 客户端期望的响应格式                                  | `application/json`           |
| **`Authorization`**   | 条件 | 访问受保护资源的 Bearer Token                         | `Bearer eyJhbGci...`         |
| **`x-request-id`**    |  ❌  | 全链路追踪 ID（若未提供，网关自动生成并回写响应头）   | `req_019572d4a6c878b18cf0`   |
| **`Idempotency-Key`** | 条件 | 非幂等写操作防重放并发唯一键（推荐 UUIDv7 / ULID）    | `019572d4-a6c8-78b1-8cf0-281b94c032a1` |
| **`If-Match`**        | 条件 | 条件更新控制：携带前序 ETag 防并发覆写（防丢失更新）  | `W/"019572d4a6c878b1"`        |

### 3.3 幂等性保障机制 (Honouring an Idempotency Key)
1. **派生自业务意图（Derive from Intent）**：Key 必须在同一业务意图的多次重试中保持稳定（如基于提交表单的唯一票据），禁止每次重试生成新 Key。
2. **唯一约束原子认领**：必须通过底层针对 `(idempotency_key)` 的 **唯一索引约束 (UNIQUE)** 在单次原子操作中认领锁，严禁 `SELECT` 查重后 `INSERT` 的竞态反模式。
3. **载荷防篡改阻断**：服务端记录首个请求 Body 的 SHA-256 哈希。若同 Key 提交了不同载荷，立即拒绝并返回 `422 Unprocessable Entity`。
4. **并发中途重试阻断**：若前序相同 Key 请求仍在处理中，后续重试请求必须返回 `409 Conflict` 提示退避，禁止并发重复执行。
5. **留存期覆盖最长重试链**：幂等 Key 的保留期（TTL）必须显著长于客户端最长重试链与异步死信重放周期。

### 3.4 条件请求与并发防丢失 (Lost Update Prevention via ETag)
- `GET /{version}/{resources}/:{id}` 响应头携带实体版本标识：`ETag: W/"<version_hash>"`；
- `PATCH` / `PUT` 更新时请求头携带 `If-Match: W/"<version_hash>"`；
- 若版本已过时，服务端拒绝写入并返回 `HTTP 412 Precondition Failed`，杜绝后写覆盖先写。

---

## 4. HTTP 方法与状态码 (HTTP Methods & Status Codes)

### 4.1 HTTP 动词语义

| 方法 | 语义 | 幂等性 | 成功返回 | 典型场景 |
| :---: | :--- | :---: | :---: | :--- |
| **`GET`** | 获取单个资源或列表 | ✅ 幂等 | `200 OK` | 读取详情、分页查询 |
| **`POST`** | 创建新资源或执行非 CRUD 操作 | ❌ 非幂等 | `201 Created` / `202 Accepted` / `200 OK` | 创建实体、提交认证、异步长任务 |
| **`PUT`** | 全量覆盖替换目标资源 | ✅ 幂等 | `200 OK` | 完整替换目标配置 |
| **`PATCH`** | 局部修改目标资源属性 | ❌/✅ 取决实现 | `200 OK` | 局部更新字段、变更状态 |
| **`DELETE`** | 销毁或注销目标资源 | ✅ 幂等 | `204 No Content` / `200 OK` | 删除资源、解绑关联 |

### 4.2 响应状态码速查

| 状态码 | 对应枚举 Code | 说明 |
| :---: | :--- | :--- |
| **`200`** | `OK` | 请求处理成功 |
| **`201`** | `CREATED` | 资源创建成功 |
| **`202`** | `ACCEPTED` | 异步长任务已受理排队，后台处理中 |
| **`204`** | `NO_CONTENT` | 请求成功，无返回数据体（0 字节） |
| **`304`** | `NOT_MODIFIED` | 资源未变更（配合 If-None-Match 缓存） |
| **`400`** | `BAD_REQUEST` | 请求格式无效、缺少必填参数或语法错误 |
| **`401`** | `UNAUTHORIZED` | 未提供身份凭证或 Token 已过期失效 |
| **`403`** | `FORBIDDEN` | 凭证有效但无权执行该操作（权限不足） |
| **`404`** | `NOT_FOUND` | 请求的资源或 URI 不存在 |
| **`409`** | `CONFLICT` | 资源状态冲突（如唯一键重复、并发重试冲突） |
| **`412`** | `PRECONDITION_FAILED` | 前置条件未满足（如 If-Match 版本冲突） |
| **`422`** | `UNPROCESSABLE_ENTITY` | 请求体字段语义或参数验证规则校验失败 |
| **`429`** | `TOO_MANY_REQUESTS` | 请求频率超出速率配额限制 |
| **`500`** | `INTERNAL_SERVER_ERROR` | 服务器内部未知异常（向外屏蔽底层实现细节） |

---

## 5. 响应格式与错误处理 (Response Structure & Error Handling)

系统遵循简洁高效的 RESTful 响应契约：
- **核心原则**：全系统**仅分页列表**采用 `{"items": [...], "pagination": {...}}` 信封；其余所有单资源、操作结果、异步任务等成功响应**一律直接返回裸 JSON 对象**，彻底废除无意义的 `success`、`code`、`message` 外层包装。

### 5.1 成功响应 (Success Response)

#### 1. 分页数据响应（全系统唯一的分页信封）

所有分页列表请求统一包裹在 `items` 与 `pagination` 中：
```json
{
  "items": [
    {
      "id": "<resource_id>",
      "<attribute>": "<value>"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

> 🛡️ **空数据保底规则**：当列表为空时，`items` **必须返回 `[]`，绝对禁止返回 `null`**：
> ```json
> {
>   "items": [],
>   "pagination": {
>     "page": 1,
>     "pageSize": 20,
>     "total": 0,
>     "totalPages": 0
>   }
> }
> ```

#### 2. 非分页对象 / 业务操作结果（裸 JSON 对象直接返回）

除分页列表外，其余所有成功响应均直接返回裸 JSON 业务对象，不加任何外壳：

- **单实体资源查询/创建/更新**：
  ```json
  {
    "id": "<resource_id>",
    "<attribute>": "<value>"
  }
  ```
- **异步任务受理 (202 Accepted)**：
  ```http
  HTTP/1.1 202 Accepted
  Location: /{version}/tasks/<task_id>
  ```
  ```json
  {
    "taskId": "<task_id>",
    "status": "PENDING"
  }
  ```

#### 3. 空响应操作 (204 No Content)

对于删除、登出、修改密码等无返回数据体的操作，统一返回 `HTTP 204 No Content`，响应体为空（0 字节，无 Body 包裹）。

---

### 5.2 错误响应 (Error Response)

所有异常与校验失败统一收敛于根级 `error` 命名空间：

#### 1. 通用业务与客户端错误 (400 / 401 / 403 / 404 / 409 / 412)
```json
{
  "error": {
    "code": "<MACHINE_READABLE_ERROR_CODE>",
    "message": "<human_readable_error_description>"
  }
}
```

#### 2. 表单与字段级参数校验失败 (422 Unprocessable Entity)

按字段键归集错误文案数组，前端可直接挂载并驱动表单控件报错：
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "fields": {
      "<field_name>": [
        "<validation_rule_failure_message>"
      ]
    }
  }
}
```

#### 3. 服务器内部异常 (500 Internal Server Error)
```json
{
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

> 🛡️ **生产脱敏与追踪规范**：
> 1. 全链路追踪 ID 统一通过响应头 `x-request-id` 返回，不污染 JSON 响应体；
> 2. 生产环境严禁向外输出任何语言异常名、源码文件路径、代码行号或数据库底层错误。未捕获异常统一转为通用提示。

---

## 6. 分页与查询规范 (Pagination & Querying)

系统提供双轨制分页：管理端与关系报表默认采用 **Offset 偏移分页**，海量流式数据与日志采用 **Cursor 游标分页**。

### 6.1 模式 A：标准 Offset 偏移分页 (管理端默认)
- **请求参数**：`page`（默认 `1`）、`pageSize`（默认 `20`，最大 `100`）。
- **响应结构**：
  ```json
  {
    "items": [
      { "id": "<resource_id>", "<attribute>": "<value>" }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 100,
      "totalPages": 5
    }
  }
  ```

### 6.2 模式 B：工业级 Cursor 游标分页 (海量数据/无限滚动)
- **请求参数**：`cursor`（上一次响应中的 `nextCursor`）、`pageSize`（默认 `20`）。
- **响应结构**：
  ```json
  {
    "items": [
      { "id": "<resource_id>", "<attribute>": "<value>" }
    ],
    "pagination": {
      "hasMore": true,
      "nextCursor": "<opaque_cursor_string>",
      "prevCursor": "<opaque_cursor_string>"
    }
  }
  ```

### 6.3 查询过滤、排序与检索规范 (Spatie / JSON:API 规范)
- **字段过滤**：
  - 精确匹配：`?filter[<field>]=<value>`
  - 多值匹配 (IN 查询)：`?filter[<field>]=<val1>,<val2>`
  - 区间过滤：`?filter[<field>After]=<date>` 或 `?filter[<field>Min]=<num>`
- **紧凑链式排序**：
  - 升序：`?sort=<field>`；降序：`?sort=-<field>`；复合排序：`?sort=-<field1>,<field2>`
  - **确定性保底**：服务端必须默认提供唯一确定性排序策略（如 ID 或创建时间倒序），防止分页遍历数据漂移（Page Drift）。
- **全局搜索**：`?search=<keyword>`（服务端在多个核心列执行模糊检索）。
- **关联加载与字段投影**：
  - 关联预加载：`?include=<relation1>,<relation2>`（杜绝 N+1 查询）
  - 稀疏字段集：`?fields[<resource>]=<field1>,<field2>`（精简传输体积）
- **综合请求示例**：
  ```http
  GET /{version}/{resources}?page=1&pageSize=20&search=<keyword>&filter[<field>]=<value>&sort=-<field>&include=<relation>
  ```

---

## 7. 速率限制 (Rate Limiting)

API 在网关与中间件层实施多级动态配额控制：
- **未认证客户端**：低频防刷配额限制；
- **已认证用户**：标准业务并发配额；
- **敏感认证端点**：高频保护防暴力破解限制。

超限返回 `429 TOO_MANY_REQUESTS`，并通过标准响应头回传配额状态：
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1756137600
```

---

## 8. 接口反模式红线与设计自检清单 (Red Flags & Checklist)

### 8.1 严厉禁止的反模式红线 (Red Flags)
- 🚩 **不可预测的多变响应结构**：同一端点根据条件返回完全不同层级或不同结构的 JSON 根体。
- 🚩 **包装泛滥反模式**：为非分页单资源或业务结果增加无意义的 `data` / `success` / `code` 外层包装。
- 🚩 **空切片反模式 (Null Array)**：无数据时返回 `null` 而非 `[]`，诱发前端 `.map()` 空指针崩溃。
- 🚩 **在 REST 路径中滥用动词**：在普通 CRUD 路径中出现 `/api/createResource`、`/api/deleteResource` 等 RPC 风格命名。
- 🚩 **无分页的无底洞列表**：开放无 `page` / `cursor` 限制的批量列表拉取端点，随着数据增长引发 OOM 甚至拖垮数据库。
- 🚩 **防重放竞态（TOCTOU）**：采用 `SELECT` 检查幂等 Key 是否存在后紧接 `INSERT`，而非依赖原子唯一约束抢占。
- 🚩 **静默吞咽载荷篡改**：收到相同的 `Idempotency-Key` 但 Payload 发生变更时，服务端未校验 Payload 哈希而直接回放上一请求的响应。
- 🚩 **破坏性字段变更**：未经版本升级直接删除公开字段、修改字段类型或将原有可选参数改为必选。

### 8.2 接口发布质量门禁自检表 (Verification Checklist)

在任何新接口上线或既有接口变更合并前，必须逐项核对：
- [ ] **响应信封精准**：仅分页列表采用 `{"items": [...], "pagination": {...}}` 信封，其余所有单对象/业务结果均直接返回裸 JSON 对象；
- [ ] **空值保底完备**：列表为空时强制返回 `{"items": [], ...}`，严禁输出 `null`；
- [ ] **强类型输入与输出**：每个端点都定义了清晰的 Request DTO 与 Resource DTO，输入输出严格解耦；
- [ ] **边界校验完备**：所有输入数据在 HTTP 接入层均通过校验器处理，校验失败标准返回 `422 Unprocessable Entity` 与 `fields` 字段；
- [ ] **错误信封统一**：所有异常均统一收敛于 `{"error": { "code": "...", "message": "..." }}` 结构；
- [ ] **时间与精度安全**：时间字段必须为 ISO 8601 UTC `Z` 格式；超大整型在传输时序列化为字符串；
- [ ] **向后兼容性**：新增需求通过添加可选字段或扩展新端点实现，废弃端点附带 `Sunset` 标头；
- [ ] **规范命名**：URL 资源路径统一使用复数名词，JSON 属性统一使用 `camelCase`，枚举值统一使用 `UPPER_SNAKE`；
- [ ] **写操作幂等**：重要状态变更与非幂等创建端点支持 `Idempotency-Key`，并经由数据库唯一约束原子抢占；
- [ ] **并发安全防护**：核心并发修改支持 `ETag` 与 `If-Match` 校验，拦截丢失更新；
- [ ] **生产脱敏与追踪**：`x-request-id` 正确回写响应头，生产环境不泄露任何调试堆栈与内部系统细节。
