import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { classifySendRejection, OtpService } from '@/common/auth/otp.service';
import { otpCodes, otpSendWindows } from '@/database/drizzle/schema';

/** 可 await 的链式查询替身（from/where 可无限链、limit/returning 终止） */
function chain<T>(result: T[]) {
  const api: Record<string, unknown> = {
    from: () => api,
    where: () => api,
    limit: () => Promise.resolve(result),
    returning: () => Promise.resolve(result),
    then: (resolve: (value: T[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return api;
}

interface SendWindowState {
  lastSentAt: Date;
  windowStartedAt: Date;
  sendCount: number;
}

interface DbOptions {
  /** 发送窗口 upsert 的返回：空数组表示被冷却/上限拒绝 */
  slot?: unknown[];
  /** 被拒后回读的窗口状态 */
  windowState?: SendWindowState;
  /** 消费阶段读到的验证码记录 */
  record?: unknown;
  /** DELETE ... RETURNING 的结果：命中表示验证码消费成功 */
  consumed?: unknown[];
}

function createService(options: DbOptions = {}) {
  const otpUpsert = vi.fn().mockResolvedValue(undefined);
  const windowUpsert = vi.fn(() =>
    options.slot && options.slot.length === 0
      ? Promise.resolve([])
      : Promise.resolve(options.slot ?? [{ sendCount: 1 }]),
  );
  const deleteWhere = vi.fn(() => chain(options.consumed ?? []));
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where: updateWhere }));

  const db = {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(() =>
        table === otpSendWindows
          ? { onConflictDoUpdate: vi.fn(() => ({ returning: windowUpsert })) }
          : { onConflictDoUpdate: otpUpsert },
      ),
    })),
    select: vi.fn(() => ({
      from: (table: unknown) =>
        chain(
          table === otpSendWindows
            ? options.windowState
              ? [options.windowState]
              : []
            : options.record
              ? [options.record]
              : [],
        ),
    })),
    delete: vi.fn(() => ({ where: deleteWhere })),
    update: vi.fn(() => ({ set })),
  };

  const mailJobs = { queueEmailOtp: vi.fn().mockResolvedValue(undefined) };
  const service = new OtpService(db as never, mailJobs as never);

  return { service, db, mailJobs, otpUpsert, windowUpsert, deleteWhere, set, updateWhere };
}

/** 取 429 响应体里的机器可读 code */
async function rejectionBody(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  const error = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(429);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

describe('classifySendRejection', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  it('无窗口记录时放行', () => {
    expect(classifySendRejection(null, now)).toBeNull();
  });

  it('冷却期内应判定为 cooldown', () => {
    expect(
      classifySendRejection({ lastSentAt: new Date(now.getTime() - 30_000), windowStartedAt: now, sendCount: 1 }, now),
    ).toBe('cooldown');
  });

  it('同一窗口内达到 5 次应判定为 hourly-limit', () => {
    expect(
      classifySendRejection(
        {
          lastSentAt: new Date(now.getTime() - 120_000),
          windowStartedAt: new Date(now.getTime() - 30 * 60_000),
          sendCount: 5,
        },
        now,
      ),
    ).toBe('hourly-limit');
  });

  it('窗口已过期时即使计数为 5 也应放行（新窗口重新计数）', () => {
    expect(
      classifySendRejection(
        {
          lastSentAt: new Date(now.getTime() - 2 * 60 * 60_000),
          windowStartedAt: new Date(now.getTime() - 2 * 60 * 60_000),
          sendCount: 5,
        },
        now,
      ),
    ).toBeNull();
  });
});

describe('OtpService', () => {
  it('发送窗口拒绝（冷却）时应返回 429 且不写入验证码', async () => {
    const { service, otpUpsert } = createService({
      slot: [],
      windowState: { lastSentAt: new Date(), windowStartedAt: new Date(), sendCount: 1 },
    });

    const body = await rejectionBody(service.sendEmailCode({ userId: 'u1', email: 'ada@example.com' }));
    expect(body).toMatchObject({ code: 'OTP_SEND_TOO_FREQUENT' });
    expect(otpUpsert).not.toHaveBeenCalled();
  });

  it('发送窗口拒绝（每小时上限）时应返回 429 且不写入验证码', async () => {
    const now = Date.now();
    const { service, otpUpsert } = createService({
      slot: [],
      windowState: {
        lastSentAt: new Date(now - 120_000),
        windowStartedAt: new Date(now - 30 * 60_000),
        sendCount: 5,
      },
    });

    const body = await rejectionBody(service.sendEmailCode({ userId: 'u1', email: 'ada@example.com' }));
    expect(body).toMatchObject({ code: 'OTP_SEND_HOURLY_LIMIT' });
    expect(otpUpsert).not.toHaveBeenCalled();
  });

  it('窗口允许（第 5 次）时应写入验证码并入队邮件', async () => {
    const { service, mailJobs, otpUpsert } = createService({ slot: [{ sendCount: 5 }] });

    await service.sendEmailCode({ userId: 'u1', email: 'Ada@Example.com', name: 'Ada' });

    expect(otpUpsert).toHaveBeenCalledTimes(1);
    expect(mailJobs.queueEmailOtp).toHaveBeenCalledWith(
      'ada@example.com',
      'Ada',
      expect.stringMatching(/^\d{6}$/),
      'zh',
    );
  });

  it('邮件入队失败应回滚验证码与发送配额并返回 503', async () => {
    const { service, mailJobs, db } = createService();
    mailJobs.queueEmailOtp.mockRejectedValueOnce(new Error('redis down'));

    await expect(service.sendEmailCode({ userId: 'u1', email: 'ada@example.com' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // 两张表各删一次：验证码 + 发送窗口（失败不应占用配额）
    expect(db.delete).toHaveBeenCalledWith(otpCodes);
    expect(db.delete).toHaveBeenCalledWith(otpSendWindows);
  });

  it('短信通道失败应回滚验证码与发送配额并返回 503', async () => {
    const { service, db } = createService();
    const previousProvider = process.env.SMS_PROVIDER;
    const previousUser = process.env.SMSBAO_USER;
    const previousPassword = process.env.SMSBAO_PASSWORD;
    process.env.SMS_PROVIDER = 'smsbao';
    delete process.env.SMSBAO_USER;
    delete process.env.SMSBAO_PASSWORD;

    try {
      await expect(service.sendSmsCode({ userId: 'u1', phoneNumber: '13800138000' })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(db.delete).toHaveBeenCalledWith(otpCodes);
      expect(db.delete).toHaveBeenCalledWith(otpSendWindows);
    } finally {
      if (previousProvider === undefined) delete process.env.SMS_PROVIDER;
      else process.env.SMS_PROVIDER = previousProvider;
      if (previousUser === undefined) delete process.env.SMSBAO_USER;
      else process.env.SMSBAO_USER = previousUser;
      if (previousPassword === undefined) delete process.env.SMSBAO_PASSWORD;
      else process.env.SMSBAO_PASSWORD = previousPassword;
    }
  });

  it('非法手机号应返回 400 而非 500', () => {
    const { service } = createService();

    expect(() => service.normalizePhone('+12025550123')).toThrow(BadRequestException);
  });

  it('验证码正确时应通过单语句删除消费并返回 true', async () => {
    const { service, updateWhere } = createService({
      record: { id: 'r1', attempts: 0, expiresAt: new Date(Date.now() + 60_000) },
      consumed: [{ id: 'r1' }],
    });

    await expect(service.verifyEmailCode({ email: 'ada@example.com', code: '123456' })).resolves.toBe(true);
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it('验证码错误时应累加尝试次数并返回 false', async () => {
    const { service, updateWhere } = createService({
      record: { id: 'r1', attempts: 0, expiresAt: new Date(Date.now() + 60_000) },
      consumed: [],
    });

    await expect(service.verifyEmailCode({ email: 'ada@example.com', code: '000000' })).resolves.toBe(false);
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });

  it('验证码过期时应删除记录并返回 false', async () => {
    const { service, deleteWhere, updateWhere } = createService({
      record: { id: 'r1', attempts: 0, expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(service.verifySmsCode({ phoneNumber: '13800138000', code: '123456' })).resolves.toBe(false);
    expect(deleteWhere).toHaveBeenCalled();
    expect(updateWhere).not.toHaveBeenCalled();
  });
});
