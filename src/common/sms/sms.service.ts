import { createHash } from 'node:crypto';

import { appName } from '@/common/constants/app.constants';

/** 短信服务商（默认 smsbao） */
export type SmsProvider = 'smsbao' | 'aliyun';

export interface SmsOtpInput {
  /** 目标手机号，接受 E.164（+8613800138000）或大陆 11 位 */
  phone: string;
  /** 验证码明文 */
  code: string;
}

const SMSBAO_ENDPOINT = 'https://api.smsbao.com/sms';
/** 单次发送默认超时（毫秒）：覆盖连接与响应，防止短信网关拖住登录链路 */
const DEFAULT_SMS_TIMEOUT_MS = 5000;
/** 硬上限：env 校验同样限制 30s，此处兜底未经过 ConfigModule 的场景（CLI/测试） */
const MAX_SMS_TIMEOUT_MS = 30_000;

/** 发送超时：`SMS_TIMEOUT_MS` 覆盖，非法值回退默认 5s，超过上限按上限截断 */
function resolveSmsTimeout(): number {
  const value = Number(process.env.SMS_TIMEOUT_MS);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_SMS_TIMEOUT_MS;
  return Math.min(value, MAX_SMS_TIMEOUT_MS);
}

/** 将底层超时异常翻译为可读的业务错误 */
function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}
/** 默认短信正文模板（未配置 `SMSBAO_CONTENT` 时使用）：签名跟随 APP_NAME */
function defaultSmsbaoContent(): string {
  return `【${appName()}】您的验证码为 {code}，5 分钟内有效。`;
}

/** 手机号脱敏（日志/异常文案用）：138****8000 */
function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

/** 归一化为大陆 11 位手机号；带其他国际区号（如 +1）的号码直接拒绝 */
export function normalizeCnPhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  // +1 等非 86 国际区号必须显式拒绝：其纯数字形态恰为 11 位且以 1 开头，会误判为大陆号码
  if (trimmed.startsWith('+') && !digits.startsWith('86')) {
    throw new Error(`手机号格式无效：${maskPhone(raw)}（仅支持中国大陆号码）`);
  }
  const local = digits.startsWith('86') && digits.length === 13 ? digits.slice(2) : digits;
  if (!/^1\d{10}$/.test(local)) {
    throw new Error(`手机号格式无效：${maskPhone(raw)}（需大陆 11 位手机号或 E.164）`);
  }
  return local;
}

/**
 * 发送登录/验证码短信。
 *
 * 通道由 `SMS_PROVIDER` 决定（默认 `smsbao`），未配置对应凭证时抛出明确错误，
 * 由调用方（Better Auth `phoneNumber.sendOTP`）转为接口错误返回。
 */
export async function sendSmsOtp({ phone, code }: SmsOtpInput): Promise<void> {
  const provider = (process.env.SMS_PROVIDER ?? 'smsbao').toLowerCase();
  const target = normalizeCnPhone(phone);

  if (provider === 'smsbao') {
    await sendViaSmsbao(target, code);
    return;
  }
  if (provider === 'aliyun') {
    await sendViaAliyun(target, code);
    return;
  }
  throw new Error(`未知的短信服务商：SMS_PROVIDER=${provider}（可选 smsbao | aliyun）`);
}

/** SMSBao：GET /sms?u=&p=MD5(password)&m=&c=，返回体 "0" 为成功 */
async function sendViaSmsbao(phone: string, code: string): Promise<void> {
  const user = process.env.SMSBAO_USER;
  const password = process.env.SMSBAO_PASSWORD;
  if (!user || !password) {
    throw new Error('短信通道未配置：请设置 SMSBAO_USER / SMSBAO_PASSWORD');
  }

  const content = (process.env.SMSBAO_CONTENT ?? defaultSmsbaoContent()).replace(/\{code\}/g, code);
  const digest = createHash('md5').update(password).digest('hex');
  const url = `${SMSBAO_ENDPOINT}?u=${encodeURIComponent(user)}&p=${digest}&m=${phone}&c=${encodeURIComponent(content)}`;

  // 短信网关不可达时不得拖住登录链路：单次发送带硬超时
  const timeout = resolveSmsTimeout();
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    if (isTimeoutError(error)) throw new Error(`短信发送超时（${timeout}ms）`, { cause: error });
    throw error;
  }
  const body = (await response.text()).trim();
  if (!response.ok || body !== '0') {
    throw new Error(`SMSBao 发送失败：HTTP ${response.status}，返回码 ${body}（0 为成功）`);
  }
}

/** 阿里云短信：模板变量固定为 ${code}，需先审核通过签名与模板 */
async function sendViaAliyun(phone: string, code: string): Promise<void> {
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
  const signName = process.env.ALIYUN_SMS_SIGN_NAME;
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE;
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    throw new Error(
      '短信通道未配置：请设置 ALIYUN_SMS_ACCESS_KEY_ID / ALIYUN_SMS_ACCESS_KEY_SECRET / ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE',
    );
  }

  // SDK 为 CJS 产物：ESM 互操作下客户端类位于 default.default（已实测），保留兜底链防版本升级
  const sdk = (await import('@alicloud/dysmsapi20170525')) as unknown as {
    default: { default?: unknown } & Record<string, unknown>;
    SendSmsRequest: new (input: Record<string, unknown>) => unknown;
  };
  const DysmsapiClient = (sdk.default.default ?? sdk.default) as new (config: unknown) => {
    sendSms: (request: unknown) => Promise<{ body?: { code?: string; message?: string } }>;
  };
  const { Config } = await import('@alicloud/openapi-client');
  const SendSmsRequest = sdk.SendSmsRequest;
  // CJS 具名导出依赖 cjs-module-lexer 探测：解析失败时 sdk.SendSmsRequest 为 undefined，
  // 直接 new 会在登录链路上抛 TypeError，故先显式暴露互操作异常
  if (typeof SendSmsRequest !== 'function') {
    throw new Error('阿里云短信 SDK 未正确导出 SendSmsRequest（CJS/ESM 互操作异常）');
  }

  const timeout = resolveSmsTimeout();
  const client = new DysmsapiClient(
    new Config({
      accessKeyId,
      accessKeySecret,
      endpoint: 'dysmsapi.aliyuncs.com',
      connectTimeout: timeout,
      readTimeout: timeout,
    }),
  );
  const request = new SendSmsRequest({
    phoneNumbers: phone,
    signName,
    templateCode,
    templateParam: JSON.stringify({ code }),
  });

  let result: { code?: string; message?: string } | undefined;
  try {
    result = (await client.sendSms(request)).body;
  } catch (error) {
    if (isTimeoutError(error)) throw new Error(`短信发送超时（${timeout}ms）`, { cause: error });
    throw error;
  }
  if (result?.code !== 'OK') {
    throw new Error(`阿里云短信发送失败：code=${result?.code ?? 'unknown'} message=${result?.message ?? ''}`);
  }
}
