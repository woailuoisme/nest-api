import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { catchError, concatMap, finalize, type Observable, of, throwError } from 'rxjs';

import { IDEMPOTENT_KEY, type IdempotentOptions } from './idempotency.decorator';
import { IdempotencyService } from './idempotency.service';

/** 默认受控的写操作动词（对齐 square1 enforced_verbs） */
const ENFORCED_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 生产级 API 幂等性拦截器（遵循 square1-io/laravel-idempotency 架构标准与 IETF/Stripe 规范）：
 * - 智能自适应：自动感知写请求 (POST/PUT/PATCH/DELETE) 中的 `Idempotency-Key` 请求头并原子接管
 * - 声明式强约束：配合 `@Idempotent({ required: true })` 强制要求客户端必须提供幂等凭证
 * - 字符与长度防注入：严格校验 Key 长度（≤256）与可见 ASCII 字符格式，不符直抛 400
 * - 作用域精隔离：已认证绑定 User ID，未认证回退客户端真实 IP
 * - 载荷与路径双校验：基于 Canonical JSON 递归键排序哈希防跨路径与 Payload 篡改（不符直抛 422）
 * - 并发优雅自旋等待：并发执行中进入窗口自旋等待并直接消费缓存（对齐 square1 waitForCacheLock）
 * - 毫秒级回放标记：响应头注入 `X-Idempotency-Replayed: true`，且自动脱敏 Set-Cookie 与剥离逐跳头
 * - 状态码持久化策略：默认缓存 2xx 与确定性 4xx 错误，排除 409/429 与 5xx 瞬态服务端错误
 * - 灵活容灾降级：默认严格 Fail-Closed（抛 503 防资损重入），支持声明式 Fail-Open 放行
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const res = http.getResponse<FastifyReply>();

    const method = req.method?.toUpperCase();
    if (!method || !ENFORCED_VERBS.has(method)) {
      return next.handle();
    }

    const metadata = this.reflector.getAllAndOverride<IdempotentOptions | undefined>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const idempotencyHeader = (req.headers['idempotency-key'] as string | undefined)?.trim();

    // 1. 若端点强制声明必须提供幂等 Key 但请求未提供，直抛 400 Bad Request
    if (metadata?.required && !idempotencyHeader) {
      throw new BadRequestException('Idempotency-Key header is required for this operation');
    }

    // 2. 若未提供 Key 且未强制要求，直接放行
    if (!idempotencyHeader) {
      return next.handle();
    }

    // 3. 校验 Idempotency-Key 格式与长度规范（RFC/Stripe 标准：<=256，可见 ASCII）
    this.idempotencyService.validateIdempotencyKey(idempotencyHeader);

    const requestPath = req.url?.split('?')[0] ?? '';
    const actor = this.resolveActor(req);
    const payloadHash = this.idempotencyService.computePayloadHash(req.body);

    const { ttlSeconds, lockTtlMs, waitTimeoutMs, fallback = 'fail-closed', cacheStatusCodes } = metadata ?? {};

    // 5. 认领分布式锁或命中回放缓存（支持自旋等待与容灾降级）
    const result = await this.idempotencyService.acquire({
      key: idempotencyHeader,
      actor,
      requestPath,
      payloadHash,
      ttlSeconds,
      lockTtlMs,
      waitTimeoutMs,
      fallback,
    });

    // 6. 若发生 fail-open 降级：直接放行业务逻辑
    if (result.bypass) {
      return next.handle();
    }

    // 7. 命中已有缓存记录：短路直接回放响应
    if (!result.acquired) {
      const { cached } = result;
      res.status(cached.statusCode);
      res.header('x-idempotency-replayed', 'true');
      const cleanHeaders = this.idempotencyService.sanitizeHeadersForReplay(cached.headers);
      for (const [k, v] of Object.entries(cleanHeaders)) {
        res.header(k, v);
      }
      return of(cached.body);
    }

    // 8. 成功持有锁：进入处理管道并在完成后持久化缓存与安全释放互斥锁
    const { cacheKey, lockKey, lockToken } = result;

    // 长事务心跳：处理耗时可能超过锁 TTL（S3 上传 / 第三方调用），
    // 不续租会让同 Key 的重试在锁到期后并行执行，制造重复副作用。
    // 停止必须挂在 finalize 上：客户端中断（退订）不会触发 concatMap / catchError，
    // 否则定时器会活过请求、在进程生命周期内持续对一个已失效的锁发起 EVAL。
    const stopHeartbeat = this.idempotencyService.startLockHeartbeat({ lockKey, lockToken, lockTtlMs });

    return next.handle().pipe(
      concatMap(async (responseBody) => {
        const statusCode = res.statusCode || 200;

        // 9. 仅缓存符合状态码策略的响应（2xx 与确定性 4xx 业务错误，绝不缓存 5xx 与 429/409）
        if (this.idempotencyService.isCacheableStatusCode(statusCode, cacheStatusCodes)) {
          await this.idempotencyService.complete({
            cacheKey,
            lockKey,
            lockToken,
            requestPath,
            payloadHash,
            statusCode,
            responseBody,
            ttlSeconds,
          });
        } else {
          // 不符合持久化条件的响应（如服务端 500 或瞬态 429），立即释放锁允许后续重试
          await this.idempotencyService.fail({ lockKey, lockToken });
        }

        return responseBody;
      }),
      catchError((error) => {
        // 发生业务异常或系统错误时立即释放锁，允许客户端再次重试
        this.idempotencyService.fail({ lockKey, lockToken }).catch(() => {});
        return throwError(() => error);
      }),
      // 覆盖 complete / error / unsubscribe 三条路径
      finalize(stopHeartbeat),
    );
  }

  /**
   * 解析请求主体作用域（优先绑定已登录 userId，未登录则绑定真实客户端 IP）
   */
  private resolveActor(req: FastifyRequest): string {
    const requestWithUser = req as { user?: { id?: string | number }; session?: { user?: { id?: string | number } } };
    const user = requestWithUser.user ?? requestWithUser.session?.user;
    return user?.id ? `user:${user.id}` : `ip:${req.ip || '127.0.0.1'}`;
  }
}
