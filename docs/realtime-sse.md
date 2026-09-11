# 实时通信 Uni-SSE 客户端接入指南

> 本文档面向 Web（H5 / PC）管理看板、数据大屏以及微信小程序等场景，规定了接入实时通信中枢的 **Uni-SSE (Server-Sent Events) 单向只读通信协议**、URL 握手参数规范、**客户端推荐实例**（**浏览器原生 EventSource**、**微信小程序分块流原生封装**、**cURL 命令行**）以及 **Bruno EventStream 联调测试规范**。

---

## 1. Uni-SSE 架构与适用边界 (Overview & Scope)

Centrifugo 提供了 **Uni-SSE (Unidirectional Server-Sent Events)** 端点，允许客户端通过标准 HTTP 长轮询持久流接收服务端的单向实时推送。

### 1.1 服务端点信息

| 环境 | 物理 SSE 端点 | 反向代理路径 (HTTPS) | 请求头要求 |
| :--- | :--- | :--- | :--- |
| **本地联调** | `http://localhost:8000/connection/uni_sse` | - | `Accept: text/event-stream` |
| **生产环境** | - | `https://api.yourdomain.com/connection/uni_sse` | `Accept: text/event-stream` |

---

### 1.2 适用场景与关键局限性对比

> ⚠️ **选型前必读：Uni-SSE 并非全功能替代方案**

| 对比维度 | Uni-SSE (单向只读流) | WebSocket (主力全功能) | 选型影响与警示 |
| :--- | :--- | :--- | :--- |
| **通信方向** | **严格单向** (Server -> Client) | **双向** (Server <-> Client) | Uni-SSE 客户端**无法发送任何消息或控制指令**。 |
| **频道多路复用** | ❌ **静态固定** (连接时定死) |  **动态复用** (`subscribe`/`unsubscribe`) | Uni-SSE 连接建立后**无法动态追加或退订频道**；若要监听新频道必须断开重连。 |
| **在场协同 (Presence)** | ❌ **完全不支持** |  **完整支持** (在线列表与进出事件) | 无法感知协同人员在线状态与 Join/Leave 事件。 |
| **受限频道动态换票** | ❌ **不支持** |  **完整支持** (`getToken`) | 只能在连接 URL Query 中传递初始 Token，无法在运行时动态申请房间凭证。 |
| **浏览器连接数限制** | ⚠️ **受限** (HTTP/1.1 下单域名最多 6 个) |  **无限制** (全站共用 1 条 TCP) | 若全站未开启 HTTP/2，打开多个浏览器标签页极易耗尽连接池导致 API 挂起。 |
| **依赖与包体积** |  **零依赖** (原生 `EventSource`) | 需要安装 SDK (如 `centrifuge-js`) | 极其适合免装包的独立轻量页面。 |

#### 推荐适用场景

1. **监控大屏与只读展示板**：如运营总控台大屏、服务器负载实时看板（仅需监听 1 个公开或管理频道，无需任何交互）。
2. **免引入 SDK 的简单 H5 页面**：仅需展示一个简单的站内未读通知计数红点。
3. **受限环境穿透**：极少数完全封禁 WebSocket (101 Switching Protocols) 的老旧企业防火墙代理。

---

## 2. URL 参数与握手规范 (Connection Parameters)

Uni-SSE 通过 HTTP GET 请求的 **URL Query 参数** 完成连接鉴权与目标频道订阅绑定。

### 2.1 请求格式

```http
GET /connection/uni_sse?cf_connect=<CONNECT_CONFIG>&cf_subscribe=<SUBSCRIBE_CONFIG> HTTP/1.1
Host: api.yourdomain.com
Accept: text/event-stream
Cache-Control: no-cache
```

### 2.2 核心查询参数解析

Centrifugo 网关识别以 `cf_` 为前缀的标准控制参数：

| Query 参数 | 类型 | 是否必填 | 格式与说明 |
| :--- | :--- | :--- | :--- |
| **`cf_connect`** | `string` (JSON) | 否 (公开频道) / 是 (私有频道) | 连接握手配置对象（需进行 URL 编码）。<br>示例：`{"token":"<Connection_JWT>"}` |
| **`cf_subscribe`** | `string` (JSON) | **是** | 待订阅频道字典（需进行 URL 编码）。<br>示例（订阅公开频道）：`{"public:announcement":{}}`<br>示例（订阅个人频道）：`{"user#01918342-9999-7000-8000-000000000001":{}}` |

> 💡 **参数编码技巧**：
> 在构造 URL 时，务必对 JSON 字符串使用 `encodeURIComponent()` 进行标准转义。
> 例如：`encodeURIComponent(JSON.stringify({ token: "..." }))`

---

## 3. 客户端生产级推荐实例 (Recommended Implementations)

---

### 3.1 推荐实例 1：Web 浏览器原生 (H5 / PC 零依赖)

现代浏览器原生内置 `EventSource`，**无需安装任何第三方 npm 依赖包**。

#### 原生封装 (`WebSSEClient.ts`)

```typescript
export interface RealtimeEnvelope<T = unknown> {
  event: string;
  channel?: string;
  targetUserId?: string;
  data: T;
  timestamp: number;
}

export class WebSSEClient {
  private eventSource: EventSource | null = null;
  private isClosed = false;

  constructor(
    private sseBaseUrl: string, // 如 http://localhost:8000/connection/uni_sse
    private apiBaseUrl: string, // 如 http://localhost:3000
    private getAuthToken: () => Promise<string>,
  ) {}

  /**
   * 监听个人私有通知流 (user#userId)
   */
  public async subscribeUser(userId: string, onMessage: (envelope: RealtimeEnvelope) => void): Promise<void> {
    const channel = `user#${userId}`;

    // 1. 请求后端获取 Connection JWT
    const authToken = await this.getAuthToken();
    const res = await fetch(`${this.apiBaseUrl}/v1/realtime/token`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) throw new Error(`获取连接凭据失败: HTTP ${res.status}`);
    const { token } = await res.json();

    // 2. 组装 Uni-SSE 握手 URL Query
    const cfConnect = encodeURIComponent(JSON.stringify({ token }));
    const cfSubscribe = encodeURIComponent(JSON.stringify({ [channel]: {} }));
    const sseUrl = `${this.sseBaseUrl}?cf_connect=${cfConnect}&cf_subscribe=${cfSubscribe}`;

    // 3. 创建原生 EventSource 连接
    this.eventSource = new EventSource(sseUrl);

    this.eventSource.onopen = () => {
      console.info(`[Uni-SSE] 已连接并成功监听频道: ${channel}`);
    };

    // 监听 Centrifugo 默认 message 事件
    this.eventSource.onmessage = (event) => {
      if (!event.data) return;
      try {
        const payload = JSON.parse(event.data);
        // Centrifugo 推送帧包裹在 pub.data 中
        if (payload.pub && payload.pub.data) {
          onMessage(payload.pub.data as RealtimeEnvelope);
        }
      } catch (err) {
        console.error('[Uni-SSE] 解析数据失败:', err, event.data);
      }
    };

    this.eventSource.onerror = (err) => {
      console.warn('[Uni-SSE] 连接发生异常或尝试重连:', err);
    };
  }

  /**
   * 监听公开广播频道 (public:name) - 免传递 Token
   */
  public subscribePublic(channelName: string, onMessage: (envelope: RealtimeEnvelope) => void): void {
    const channel = `public:${channelName}`;
    const cfSubscribe = encodeURIComponent(JSON.stringify({ [channel]: {} }));
    const sseUrl = `${this.sseBaseUrl}?cf_subscribe=${cfSubscribe}`;

    this.eventSource = new EventSource(sseUrl);

    this.eventSource.onmessage = (event) => {
      if (!event.data) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.pub && payload.pub.data) {
          onMessage(payload.pub.data as RealtimeEnvelope);
        }
      } catch (err) {
        console.error('[Uni-SSE] 解析广播数据失败:', err);
      }
    };
  }

  public close(): void {
    this.isClosed = true;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      console.info('[Uni-SSE] 连接已关闭');
    }
  }
}
```

---

### 3.2 推荐实例 2：微信小程序 (WeChat Mini Program - 原生分块流解析)

微信小程序运行环境中**没有浏览器的 `EventSource`**。但微信基础库（2.10.0+）提供了 `wx.request({ enableChunked: true })` API，可直接监听 HTTP 分块流 (`onChunkReceived`)，在小程序端原生实现 SSE 行协议解析。

> ⚠️ **微信公众平台配置提醒**：
> 微信小程序中使用 SSE 必须将实时网关域名加入微信公众平台的 **`request 合法域名`**（必须为 `https://` 前缀）。

#### 微信小程序 SSE 客户端 (`wechat-sse-client.ts`)

```typescript
export interface WechatSSEOptions {
  sseUrl: string; // 如 https://api.yourdomain.com/connection/uni_sse
  apiBaseUrl: string; // 如 https://api.yourdomain.com
  getAuthToken: () => Promise<string>;
}

export interface RealtimeEnvelope<T = unknown> {
  event: string;
  channel?: string;
  targetUserId?: string;
  data: T;
  timestamp: number;
}

export class WechatSSEClient {
  private requestTask: WechatMiniprogram.RequestTask | null = null;
  private buffer = ''; // 分块行接收缓冲区
  private isClosed = false;

  constructor(private options: WechatSSEOptions) {}

  /**
   * 监听个人私有频道 (user#userId)
   */
  public async subscribeUser(userId: string, onMessage: (envelope: RealtimeEnvelope) => void): Promise<void> {
    this.isClosed = false;
    const channel = `user#${userId}`;

    // 1. 获取业务后端 Connection Token
    let connectionToken: string;
    try {
      connectionToken = await this.fetchConnectionToken();
    } catch (e) {
      console.error('[WechatSSE] 获取连接凭据失败:', e);
      return;
    }

    // 2. 拼接 Uni-SSE URL
    const cfConnect = encodeURIComponent(JSON.stringify({ token: connectionToken }));
    const cfSubscribe = encodeURIComponent(JSON.stringify({ [channel]: {} }));
    const fullUrl = `${this.options.sseUrl}?cf_connect=${cfConnect}&cf_subscribe=${cfSubscribe}`;

    // 3. 发起原生分块流请求
    this.requestTask = wx.request({
      url: fullUrl,
      method: 'GET',
      enableChunked: true, // 核心：开启分块传输监听
      header: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      success: (res) => {
        console.info('[WechatSSE] 连接正常断开/完成:', res.statusCode);
      },
      fail: (err) => {
        if (!this.isClosed) {
          console.error('[WechatSSE] 请求异常:', err);
        }
      },
    });

    // 4. 监听分块流响应 (ArrayBuffer)
    this.requestTask.onChunkReceived((result) => {
      // 将 ArrayBuffer 转为 UTF-8 文本
      const chunkText = this.arrayBufferToString(result.data);
      this.buffer += chunkText;

      // 按 SSE 标准以双换行符 \n\n 切分消息块
      const messages = this.buffer.split('\n\n');
      // 最后一个可能未完全接收，保留在 buffer
      this.buffer = messages.pop() || '';

      for (const msg of messages) {
        this.parseSSEMessage(msg, onMessage);
      }
    });
  }

  /**
   * 解析标准 SSE 消息行 (data: {...})
   */
  private parseSSEMessage(rawMessage: string, onMessage: (env: RealtimeEnvelope) => void) {
    const lines = rawMessage.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;

        try {
          const payload = JSON.parse(jsonStr);
          if (payload.pub && payload.pub.data) {
            onMessage(payload.pub.data as RealtimeEnvelope);
          }
        } catch (e) {
          console.error('[WechatSSE] 解析 SSE 数据失败:', e, jsonStr);
        }
      }
    }
  }

  /**
   * ArrayBuffer 转 UTF-8 字符串
   */
  private arrayBufferToString(buffer: ArrayBuffer): string {
    // 基础库支持使用 Uint8Array 逐字节转码
    const uint8Array = new Uint8Array(buffer);
    let out = '';
    for (let i = 0; i < uint8Array.length; i++) {
      out += String.fromCharCode(uint8Array[i]);
    }
    try {
      return decodeURIComponent(escape(out));
    } catch {
      return out;
    }
  }

  private fetchConnectionToken(): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const token = await this.options.getAuthToken();
      wx.request({
        url: `${this.options.apiBaseUrl}/v1/realtime/token`,
        method: 'GET',
        header: { Authorization: `Bearer ${token}` },
        success: (res) => {
          if (res.statusCode === 200) {
            resolve((res.data as any).token);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        },
        fail: reject,
      });
    });
  }

  public close(): void {
    this.isClosed = true;
    if (this.requestTask) {
      this.requestTask.abort();
      this.requestTask = null;
      console.info('[WechatSSE] 小程序流连接已终止');
    }
  }
}
```

---

### 3.3 推荐实例 3：cURL 命令行快速联调

在终端中只需一条命令即可验证 Uni-SSE 流是否畅通：

```bash
# 1. 订阅全网公开广播
curl -N -H "Accept: text/event-stream" \
  "http://localhost:8000/connection/uni_sse?cf_subscribe=%7B%22public%3Aannouncement%22%3A%7B%7D%7D"

# 2. 携带 Token 订阅个人私有频道
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI..."
USER_ID="01918342-9999-7000-8000-000000000001"

CONNECT_JSON=$(printf '{"token":"%s"}' "$TOKEN")
SUB_JSON=$(printf '{"user#%s":{}}' "$USER_ID")

curl -N -H "Accept: text/event-stream" \
  --get \
  --data-urlencode "cf_connect=${CONNECT_JSON}" \
  --data-urlencode "cf_subscribe=${SUB_JSON}" \
  "http://localhost:8000/connection/uni_sse"
```

---

## 4. Bruno SSE 联调测试指南 (Bruno EventStream Suite)

在 [Bruno](https://www.usebruno.com/) 中测试单向只读流时，采用标准 **HTTP Request**。

### 测试用例：`2-SSE-EventStream.bru`

- **方法**：`GET`
- **URL**：`{{baseUrl}}/connection/uni_sse`
- **请求头**：`Accept: text/event-stream`

```bru
meta {
  name: 2. 建立 Uni-SSE 单向事件流
  type: http
  seq: 2
}

get {
  url: {{sseUrl}}?cf_connect={"token":"{{realtimeConnectionToken}}"}&cf_subscribe={"user#{{userId}}":{}}
  headers {
    Accept: text/event-stream
    Cache-Control: no-cache
  }
}

tests {
  test("响应头 Content-Type 应为 text/event-stream", function() {
    expect(res.getHeader('content-type')).to.include('text/event-stream');
  });
}
```

在 Bruno 界面点击发送后，下方响应面板将保持流式监听状态（Streaming），当后端广播事件时将持续打印输出以 `data:` 开头的 JSON 字符串。

---

## 5. 生产环境部署与反向代理避坑指南 (Nginx & FAQ)

### 5.1 Nginx 必须关闭 Buffering (防缓冲卡死)

SSE 依赖 HTTP 长连接持续传输分块。如果 Nginx 默认开启了 `proxy_buffering`，会导致服务端推送的消息被 Nginx 缓冲区扣留，无法实时下发到客户端！

**Nginx 生产配置必备**：

```nginx
location /connection/uni_sse {
    proxy_pass http://centrifugo:8000;
    proxy_http_version 1.1;

    # 关键配置：必须禁用代理缓冲与缓存
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding on;

    # 超时保活时间适当放宽
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

### 5.2 常见排障 FAQ

#### Q1: 为什么浏览器收不到推送，断开后才一次性吐出所有消息？

- **原因**：100% 是反向代理层（如 Nginx、Traefik、Cloudflare）开启了响应缓冲（Buffering）。请检查并添加 `proxy_buffering off;`。

#### Q2: 为什么多开几个 Tab 后网页卡死，无法加载其他接口？

- **原因**：全站运行在 HTTP/1.1 协议下，浏览器对同域名最多仅允许 **6 个并发 TCP 连接**。若多个 Tab 均常驻一个 SSE 连接，会把浏览器的并发请求池耗尽。
- **解决方案**：生产环境务必升级到 **HTTP/2**（支持多路复用），或引导富客户端改用 **WebSocket**。
