import type {
  Code2SessionResult,
  CreatePlainQrCodeInput,
  CreateQrCodeInput,
  CreateUnlimitedQrCodeInput,
  GetPhoneNumberInput,
  MiniprogramAccessToken,
  MiniprogramDriverHealth,
  MiniprogramPhoneInfo,
  MiniprogramQrCodeImage,
  MsgSecCheckInput,
  MsgSecCheckResult,
  SendSubscribeMessageInput,
  SessionKeyResult,
} from '../interfaces/miniprogram.interface';

/**
 * 微信小程序服务端 API 驱动契约
 *
 * 与项目 `search/`、`wechat/pay/` 的多驱动范式对齐：real 驱动对接真实微信小程序 API，
 * mock 驱动提供确定性假数据但保持完全相同的入参校验与返回结构，
 * 使「小程序登录 → 换取手机号 → 生成小程序码 → 内容安全 → 订阅消息」全链路可在无真实小程序下跑通。
 */
export interface IMiniprogramDriver {
  readonly name: 'real' | 'mock';

  // ── 接口调用凭据 ────────────────────────────────────────
  /** 获取 access_token（内部缓存，普通模式下有效期内返回同一凭证） */
  getAccessToken(): Promise<string>;
  /** 强制刷新 access_token（仅用于凭证失效后的重试，注意官方强刷限额） */
  refreshAccessToken(): Promise<string>;

  // ── 登录 ────────────────────────────────────────────────
  /** 登录凭证校验：js_code 换 openid / session_key */
  code2Session(jsCode: string): Promise<Code2SessionResult>;
  /** 校验 session_key 是否仍然有效 */
  checkSessionKey(openid: string, sessionKey: string): Promise<boolean>;
  /** 重置指定用户的 session_key，返回重置后的新会话密钥 */
  resetUserSessionKey(openid: string, sessionKey: string): Promise<SessionKeyResult>;

  // ── 手机号 ──────────────────────────────────────────────
  /** 手机号快速验证：code 换手机号 */
  getPhoneNumber(input: GetPhoneNumberInput): Promise<MiniprogramPhoneInfo>;

  // ── 小程序码 / 小程序二维码 ─────────────────────────────
  /** 获取不限制的小程序码（数量无限制，推荐） */
  createUnlimitedQrCode(input: CreateUnlimitedQrCodeInput): Promise<MiniprogramQrCodeImage>;
  /** 获取小程序码（总量限 10 万个） */
  createQrCode(input: CreateQrCodeInput): Promise<MiniprogramQrCodeImage>;
  /** 获取小程序二维码（总量限 10 万个） */
  createPlainQrCode(input: CreatePlainQrCodeInput): Promise<MiniprogramQrCodeImage>;

  // ── 内容安全 ────────────────────────────────────────────
  /** 文本内容安全识别 */
  checkText(input: MsgSecCheckInput): Promise<MsgSecCheckResult>;

  // ── 订阅消息 ────────────────────────────────────────────
  /** 发送订阅消息 */
  sendSubscribeMessage(input: SendSubscribeMessageInput): Promise<void>;

  // ── 运维 ────────────────────────────────────────────────
  /** 本地校验健康状态（不发起外部请求） */
  checkHealth(): MiniprogramDriverHealth;
}

/**
 * access_token 缓存与互斥能力
 *
 * 由 {@link IMiniprogramDriver} 的真实驱动消费。项目 `RedisService` 在结构上天然满足该契约
 * （`get` / `set` / `withLock` 签名一致），因此生产环境直接注入 Redis 实现多 Pod 共享；
 * 单元测试可注入内存实现。
 */
export interface MiniprogramTokenCache {
  get(key: string): Promise<string | null>;
  /** ttlSeconds 必填：凭证缓存绝不允许以「立即过期」的形态写入 */
  set(key: string, value: string, ttlSeconds: number): Promise<'OK' | null>;
  /**
   * 分布式互斥执行（可选）
   *
   * 用于防止多实例同时回源刷新 access_token。未实现时退化为直接执行 ——
   * 由于 `stable_token` 普通模式幂等（有效期内重复调用返回同一凭证），并发回源只会多一次调用，
   * 不影响正确性，故该能力属优化而非必需。
   *
   * @returns 抢占成功返回业务结果；未抢到锁返回 null
   */
  withLock?<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null>;
}

/** access_token 获取回调：由驱动提供底层 HTTP 调用，避免缓存层反向依赖驱动 */
export type MiniprogramTokenFetcher = (forceRefresh: boolean) => Promise<MiniprogramAccessToken>;
