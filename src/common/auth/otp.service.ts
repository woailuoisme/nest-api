import { createHmac, randomInt, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, gt, lt, lte, or, sql } from 'drizzle-orm';

import { normalizeEmail } from '@/common/auth/email.util';
import type { MailLocale } from '@/common/mail/mail.types';
import { normalizeCnPhone, sendSmsOtp } from '@/common/sms/sms.service';
import type { Database } from '@/database/drizzle/database';
import { otpCodes, otpSendWindows } from '@/database/drizzle/schema';
import { MailJobs } from '@/jobs/mail/mail.jobs';

/** 验证码有效期（对外由端点回传 expiresInSeconds） */
export const OTP_CODE_TTL_MS = 5 * 60_000;
/** 同一目标的最小重发间隔 */
const RESEND_COOLDOWN_MS = 60_000;
/** 发送窗口长度 */
const SEND_WINDOW_MS = 60 * 60_000;
/** 同一目标在单个窗口内最多发送次数 */
const MAX_SENDS_PER_WINDOW = 5;

/** 发送被拒的原因 */
export type OtpSendRejection = 'cooldown' | 'hourly-limit';

/**
 * 依据发送窗口状态判断本次发送是否应被拒（纯函数，单测直接覆盖）。
 *
 * 与 SQL 中的原子谓词保持一致：SQL 负责「并发安全地判定 + 自增」，
 * 本函数负责「被拒后给出准确原因」，两者必须同源同阈值。
 */
export function classifySendRejection(
  state: { lastSentAt: Date; windowStartedAt: Date; sendCount: number } | null,
  now: Date,
): OtpSendRejection | null {
  if (!state) return null;
  if (now.getTime() - state.lastSentAt.getTime() < RESEND_COOLDOWN_MS) return 'cooldown';

  const inSameWindow = now.getTime() - state.windowStartedAt.getTime() < SEND_WINDOW_MS;
  if (inSameWindow && state.sendCount >= MAX_SENDS_PER_WINDOW) return 'hourly-limit';

  return null;
}
/** 单条验证码允许的最大校验失败次数 */
const MAX_ATTEMPTS = 5;

export type OtpPurpose = 'verify-email' | 'verify-phone';

interface IssueOtpInput {
  channel: 'email' | 'sms';
  purpose: OtpPurpose;
  target: string;
  userId: string;
}

/**
 * 邮箱 / 手机验证码服务（归属验证用，不做免密登录）。
 *
 * - 验证码 6 位、5 分钟有效、**单次使用（消费为单语句 CAS，并发下只有一个请求能成功）**；
 * - 同目标 60s 内不可重发，每小时最多 5 次；失败次数达到 5 次即作废；
 * - 只存 HMAC-SHA256 摘要（HMAC key 取 `JWT_SECRET`），库泄露无法直接还原验证码；
 * - `otp_codes` 上有 `unique(target, purpose)`，并发发送走 upsert，不会产生多条有效记录。
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly mailJobs: MailJobs,
  ) {}

  /** 发送邮箱验证码到用户当前邮箱 */
  async sendEmailCode(params: { userId: string; email: string; name?: string; locale?: MailLocale }): Promise<void> {
    const target = normalizeEmail(params.email);
    const code = await this.issue({ channel: 'email', purpose: 'verify-email', target, userId: params.userId });

    try {
      await this.mailJobs.queueEmailOtp(target, params.name ?? target, code, params.locale ?? 'zh');
    } catch (error) {
      // 入队失败必须回滚，否则用户会被 60s 冷却锁死且收不到任何验证码
      await this.discard(target, 'verify-email');
      this.logger.error(`Email OTP enqueue failed for ${target}: ${(error as Error).message}`);
      throw new ServiceUnavailableException('邮件服务暂不可用，请稍后重试');
    }
  }

  /** 发送手机验证码到待绑定的手机号 */
  async sendSmsCode(params: { userId: string; phoneNumber: string }): Promise<void> {
    const target = this.normalizePhone(params.phoneNumber);
    const code = await this.issue({ channel: 'sms', purpose: 'verify-phone', target, userId: params.userId });

    try {
      await sendSmsOtp({ phone: target, code });
    } catch (error) {
      await this.discard(target, 'verify-phone');
      this.logger.error(`SMS OTP delivery failed for ${maskPhone(target)}: ${(error as Error).message}`);
      throw new ServiceUnavailableException('短信服务暂不可用，请稍后重试');
    }
  }

  /** 校验邮箱验证码；成功后验证码即作废 */
  async verifyEmailCode(params: { email: string; code: string }): Promise<boolean> {
    return this.consume({
      channel: 'email',
      purpose: 'verify-email',
      target: normalizeEmail(params.email),
      code: params.code,
    });
  }

  /** 校验手机验证码；成功后验证码即作废 */
  async verifySmsCode(params: { phoneNumber: string; code: string }): Promise<boolean> {
    return this.consume({
      channel: 'sms',
      purpose: 'verify-phone',
      target: this.normalizePhone(params.phoneNumber),
      code: params.code,
    });
  }

  /** 归一化大陆手机号；非法格式统一映射为 400（避免落成 500） */
  normalizePhone(raw: string): string {
    try {
      return normalizeCnPhone(raw);
    } catch {
      throw new BadRequestException('手机号格式无效（需大陆 11 位或 E.164）');
    }
  }

  // ─── 内部实现 ──────────────────────────────────────────

  /** 生成并存储验证码（同目标 + 用途 upsert），返回明文供投递使用 */
  private async issue(input: IssueOtpInput): Promise<string> {
    const now = new Date();
    await this.acquireSendSlot(input.target, input.purpose, now);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(now.getTime() + OTP_CODE_TTL_MS);
    const values = {
      id: randomUUID(),
      channel: input.channel,
      target: input.target,
      purpose: input.purpose,
      userId: input.userId,
      codeHash: hashCode(input.target, code),
      attempts: 0,
      createdAt: now,
      expiresAt,
    };

    await this.db
      .insert(otpCodes)
      .values(values)
      .onConflictDoUpdate({
        target: [otpCodes.target, otpCodes.purpose],
        set: {
          id: values.id,
          channel: values.channel,
          userId: values.userId,
          codeHash: values.codeHash,
          attempts: 0,
          createdAt: now,
          expiresAt,
        },
      });

    return code;
  }

  /**
   * 原子抢占一次发送配额：单语句同时完成「冷却/窗口上限校验」与「计数自增」。
   *
   * 被拒的请求不会自增（`ON CONFLICT DO UPDATE ... WHERE` 不命中即不写），
   * 因此并发重试不会互相消耗配额；窗口过期时在同一条语句内重置为 1。
   */
  private async acquireSendSlot(target: string, purpose: OtpPurpose, now: Date): Promise<void> {
    const windowStart = new Date(now.getTime() - SEND_WINDOW_MS);
    const cooldownStart = new Date(now.getTime() - RESEND_COOLDOWN_MS);

    const [slot] = await this.db
      .insert(otpSendWindows)
      .values({ target, purpose, windowStartedAt: now, sendCount: 1, lastSentAt: now })
      .onConflictDoUpdate({
        target: [otpSendWindows.target, otpSendWindows.purpose],
        set: {
          sendCount: sql`CASE WHEN ${otpSendWindows.windowStartedAt} <= ${windowStart} THEN 1 ELSE ${otpSendWindows.sendCount} + 1 END`,
          windowStartedAt: sql`CASE WHEN ${otpSendWindows.windowStartedAt} <= ${windowStart} THEN ${now} ELSE ${otpSendWindows.windowStartedAt} END`,
          lastSentAt: now,
        },
        setWhere: and(
          lte(otpSendWindows.lastSentAt, cooldownStart),
          or(lte(otpSendWindows.windowStartedAt, windowStart), lt(otpSendWindows.sendCount, MAX_SENDS_PER_WINDOW)),
        ),
      })
      .returning({ sendCount: otpSendWindows.sendCount });

    if (slot) return;

    // 拒绝路径：回读窗口以区分「冷却」与「窗口上限」（低频路径，多一次读可接受）
    const [state] = await this.db
      .select({
        lastSentAt: otpSendWindows.lastSentAt,
        windowStartedAt: otpSendWindows.windowStartedAt,
        sendCount: otpSendWindows.sendCount,
      })
      .from(otpSendWindows)
      .where(and(eq(otpSendWindows.target, target), eq(otpSendWindows.purpose, purpose)))
      .limit(1);

    const rejection = classifySendRejection(state ?? null, now) ?? 'hourly-limit';
    const message = rejection === 'cooldown' ? '验证码发送过于频繁，请稍后再试' : '验证码发送次数已达上限，请稍后再试';
    const code = rejection === 'cooldown' ? 'OTP_SEND_TOO_FREQUENT' : 'OTP_SEND_HOURLY_LIMIT';

    throw new HttpException({ code, message }, HttpStatus.TOO_MANY_REQUESTS);
  }

  /**
   * 校验并消费验证码。
   *
   * 单次使用由「单语句 DELETE ... WHERE id=? AND code_hash=? RETURNING id」保证：
   * 并发提交时数据库只有一个事务能删除成功；失败路径用 SQL 自增累加尝试次数。
   */
  private async consume(input: {
    channel: 'email' | 'sms';
    purpose: OtpPurpose;
    target: string;
    code: string;
  }): Promise<boolean> {
    const [record] = await this.db
      .select({ id: otpCodes.id, attempts: otpCodes.attempts, expiresAt: otpCodes.expiresAt })
      .from(otpCodes)
      .where(and(eq(otpCodes.target, input.target), eq(otpCodes.purpose, input.purpose)))
      .limit(1);

    if (!record) return false;

    if (record.expiresAt.getTime() <= Date.now() || record.attempts >= MAX_ATTEMPTS) {
      await this.db.delete(otpCodes).where(eq(otpCodes.id, record.id));
      return false;
    }

    const [consumed] = await this.db
      .delete(otpCodes)
      .where(
        and(
          eq(otpCodes.id, record.id),
          eq(otpCodes.codeHash, hashCode(input.target, input.code)),
          gt(otpCodes.expiresAt, new Date()),
        ),
      )
      .returning({ id: otpCodes.id });

    if (consumed) return true;

    await this.db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.id, record.id));
    return false;
  }

  /** 投递失败时回滚验证码与发送配额，避免用户被冷却/窗口上限锁死 */
  private async discard(target: string, purpose: OtpPurpose): Promise<void> {
    await this.db.delete(otpCodes).where(and(eq(otpCodes.target, target), eq(otpCodes.purpose, purpose)));
    await this.db
      .delete(otpSendWindows)
      .where(and(eq(otpSendWindows.target, target), eq(otpSendWindows.purpose, purpose)));
  }
}

/**
 * 验证码摘要密钥。
 *
 * 优先使用专用 `OTP_HMAC_KEY`（生产由 env 校验强制要求）；缺失时以 `JWT_SECRET` 做
 * **域分离派生**（不把签名密钥原样复用为 HMAC key）；两者都没有则直接失败，
 * 绝不回落到硬编码常量——否则「库泄露无法还原验证码」的承诺不成立。
 */
function resolveOtpPepper(): string {
  const explicit = process.env.OTP_HMAC_KEY?.trim();
  if (explicit) return explicit;

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (jwtSecret) {
    return createHmac('sha256', jwtSecret).update('nest-api:otp-pepper').digest('hex');
  }

  throw new Error('OTP_HMAC_KEY 未配置：请设置 OTP_HMAC_KEY（≥32 字符）后再发送验证码');
}

/** 验证码摘要：HMAC-SHA256(pepper, target:code)，输出 hex */
function hashCode(target: string, code: string): string {
  return createHmac('sha256', resolveOtpPepper()).update(`${target}:${code}`).digest('hex');
}

/** 手机号脱敏（日志用） */
function maskPhone(phone: string): string {
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '***';
}
