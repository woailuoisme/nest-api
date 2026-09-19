/** 驱动类型：real 走真实微信小程序服务端 API，mock 走本地确定性假数据 */
export type MiniprogramDriverName = 'real' | 'mock';

/** 小程序码打开的小程序版本 */
export type MiniprogramQrEnvVersion = 'release' | 'trial' | 'develop';

/** 订阅消息跳转的小程序版本 */
export type MiniprogramSubscribeState = 'developer' | 'trial' | 'formal';

/** 订阅消息语言 */
export type MiniprogramLang = 'zh_CN' | 'en_US' | 'zh_HK' | 'zh_TW';

/** 内容安全建议：pass 通过、review 建议人工审核、risky 违规 */
export type MiniprogramContentSuggest = 'pass' | 'review' | 'risky';

/** 内容安全场景枚举（1 资料；2 评论；3 论坛；4 社交日志） */
export type MiniprogramContentScene = 1 | 2 | 3 | 4;

// ── 接口调用凭据 ──────────────────────────────────────────────────────

/** access_token 获取结果（expiresIn 在普通模式下返回的是剩余有效时间） */
export interface MiniprogramAccessToken {
  accessToken: string;
  expiresIn: number;
}

// ── 登录 ──────────────────────────────────────────────────────────────

/** 登录凭证校验结果 */
export interface Code2SessionResult {
  /** 用户在直连小程序 appid 下的唯一标识 */
  openid: string;
  /**
   * 会话密钥
   *
   * **严禁下发到前端或写入日志**：它既是旧版开放数据的解密密钥，也是登录态签名的密钥。
   */
  sessionKey: string;
  /** 用户在开放平台的唯一标识，绑定开放平台账号后返回 */
  unionid?: string;
}

/** 重置登录态结果 */
export interface SessionKeyResult {
  openid: string;
  sessionKey: string;
}

// ── 手机号 ────────────────────────────────────────────────────────────

/** 手机号获取入参 */
export interface GetPhoneNumberInput {
  /** 手机号获取凭证（`button open-type="getPhoneNumber"` 回调返回，一次性、5 分钟有效） */
  code: string;
  /** 可选：填入后会校验与 code 的绑定关系，不匹配时接口报错 */
  openid?: string;
}

/** 手机号信息 */
export interface MiniprogramPhoneInfo {
  /** 用户绑定的手机号（国外手机号含区号） */
  phoneNumber: string;
  /** 不含区号的手机号 */
  purePhoneNumber: string;
  /** 区号 */
  countryCode: string;
  /** 数据水印，用于校验数据来源 */
  watermark?: { timestamp: number; appid: string };
}

// ── 小程序码 / 小程序二维码 ───────────────────────────────────────────

/** 小程序码图片（基建层只交还原始字节与 MIME，不做存储决策） */
export interface MiniprogramQrCodeImage {
  buffer: Buffer;
  /** 微信返回的 Content-Type，通常为 image/jpeg 或 image/png */
  contentType: string;
}

/** 获取不限制的小程序码入参 */
export interface CreateUnlimitedQrCodeInput {
  /**
   * 场景值，最大 32 个可见字符
   *
   * 字符集受限：仅数字、大小写英文与部分特殊字符，中文与 `%` 需自行编码为合法字符集。
   * 建议放短编码或索引，业务参数在数据库侧还原。
   */
  scene: string;
  /** 已发布的小程序页面路径，根路径前不要加 `/`，不能携带参数（参数放 scene） */
  page?: string;
  /** 是否校验 page 是否存在，默认 true */
  checkPath?: boolean;
  /** 打开的小程序版本，默认 release */
  envVersion?: MiniprogramQrEnvVersion;
  /** 宽度（px），范围 280~1280，默认 430 */
  width?: number;
  /** 自动配置线条颜色 */
  autoColor?: boolean;
  /** 线条颜色（autoColor 为 false 时生效） */
  lineColor?: { r: number; g: number; b: number };
  /** 是否透明底色 */
  isHyaline?: boolean;
}

/** 获取小程序码入参（总量限 10 万个，适用于码数量较少的场景） */
export interface CreateQrCodeInput {
  /** 已发布的小程序页面路径，最大 128 字节，不能携带参数 */
  path: string;
  /** 宽度（px），范围 280~1280，默认 430 */
  width?: number;
  autoColor?: boolean;
  lineColor?: { r: number; g: number; b: number };
  isHyaline?: boolean;
}

/** 获取小程序二维码入参（总量限 10 万个，无圆形码外观，适用于码数量较少的场景） */
export interface CreatePlainQrCodeInput {
  /** 已发布的小程序页面路径，最大 128 字节，不能携带参数 */
  path: string;
  /** 宽度（px），范围 280~1280，默认 430 */
  width?: number;
}

// ── 内容安全 ──────────────────────────────────────────────────────────

/** 文本内容安全检测入参 */
export interface MsgSecCheckInput {
  /** 待检测文本，上限 2500 字 */
  content: string;
  /** 场景枚举 */
  scene: MiniprogramContentScene;
  /** 用户 openid（用户需在近两小时内访问过小程序） */
  openid: string;
  /** 文本标题 */
  title?: string;
  /** 用户昵称 */
  nickname?: string;
  /** 个性签名，仅 scene=1（资料）时有效 */
  signature?: string;
}

/** 内容安全单项检测结果 */
export interface MsgSecCheckDetail {
  /** 策略类型，如 content_model / keyword */
  strategy?: string;
  /** 该项检测是否成功（0 为成功，非 0 时该项结果无效） */
  errcode?: number;
  suggest?: MiniprogramContentSuggest;
  label?: number;
  /** 命中的自定义关键词 */
  keyword?: string;
  /** 置信度 0~100 */
  prob?: number;
  level?: number;
}

/**
 * 文本内容安全检测结果
 *
 * 注意：内容安全 **2.0** 在检测到违规时仍返回 `errcode = 0`，是否违规需依据 `result.suggest` 判定
 * （1.0 才用 `errcode = 87014` 表达违规），故此处统一归一化为 `suggest` / `pass`。
 */
export interface MsgSecCheckResult {
  /** 唯一请求标识，便于向微信追查 */
  traceId?: string;
  suggest: MiniprogramContentSuggest;
  label: number;
  /** 标签中文描述 */
  labelDescription?: string;
  /** `suggest === 'pass'` 时为 true，便于调用方直接分支 */
  pass: boolean;
  detail: MsgSecCheckDetail[];
  /** 微信原始应答体，供业务按需读取扩展字段 */
  raw: Record<string, unknown>;
}

// ── 订阅消息 ──────────────────────────────────────────────────────────

/** 发送订阅消息入参 */
export interface SendSubscribeMessageInput {
  /** 接收者 openid */
  touser: string;
  /** 订阅模板 ID */
  templateId: string;
  /** 模板内容，形如 `{ "phrase3": { "value": "审核通过" } }` */
  data: Record<string, { value: string }>;
  /** 点击卡片后的跳转页面，支持带参数（如 index?foo=bar） */
  page?: string;
  /** 跳转的小程序版本，默认 formal（正式版） */
  miniprogramState?: MiniprogramSubscribeState;
  /** 小程序语言，默认 zh_CN */
  lang?: MiniprogramLang;
}

// ── 运维 ──────────────────────────────────────────────────────────────

/** 驱动健康状态（仅本地校验，不发起外部请求） */
export interface MiniprogramDriverHealth {
  status: 'up' | 'degraded';
  driver: MiniprogramDriverName;
  /** 凭证是否配置齐全（mock 驱动恒为 false） */
  configured: boolean;
  message?: string;
}
