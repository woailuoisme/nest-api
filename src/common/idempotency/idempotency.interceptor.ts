import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { catchError, concatMap, type Observable, of, throwError } from 'rxjs';
import { IDEMPOTENT_KEY, type IdempotentOptions } from './idempotency.decorator';
import { IdempotencyService } from './idempotency.service';

/**
 * 生产级 API 幂等性拦截器：
 * - 智能自适应：自动感知写请求 (POST/PATCH/PUT/DELETE) 中的 `Idempotency-Key` 请求头并原子接管
 * - 声明式强约束：配合 `@Idempotent({ required: true })` 强制要求客户端提供幂等凭证
 * - 载荷防篡改：校验 SHA-256 哈希，同 Key 载荷不一致拒绝并返回 422
 * - 并发防重放：并发处理中返回 409 退避提示
 * - 响应毫秒级回放：命中已完成幂等记录时短路 RxJS 处理流直接写回历史响应，附带 `X-Idempotency-Replayed: true`
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
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }

    const metadata = this.reflector.getAllAndOverride<IdempotentOptions | undefined>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const idempotencyHeader = (req.headers['idempotency-key'] as string | undefined)?.trim();

    if (metadata?.required && !idempotencyHeader) {
      throw new BadRequestException('Idempotency-Key header is required for this operation');
    }

    if (!idempotencyHeader) {
      return next.handle();
    }

    const requestPath = (req.url || '').split('?')[0];
    const user =
      (req as { user?: { id?: string }; session?: { user?: { id?: string } } }).user ??
      (req as { session?: { user?: { id?: string } } }).session?.user;
    const userId = user?.id ? String(user.id) : null;
    const actorType = userId ? 'user' : 'system';
    const payloadHash = this.idempotencyService.computePayloadHash(req.body);
    const ttlSeconds = metadata?.ttlSeconds;

    const result = await this.idempotencyService.acquire({
      key: idempotencyHeader,
      requestPath,
      requestMethod: method,
      actorType,
      userId,
      payloadHash,
      ttlSeconds,
    });

    if (!result.acquired) {
      const { cached } = result;
      res.status(cached.statusCode);
      res.header('x-idempotency-replayed', 'true');
      if (cached.headers) {
        for (const [k, v] of Object.entries(cached.headers)) {
          res.header(k, v);
        }
      }
      return of(cached.body);
    }

    const recordId = result.recordId;

    return next.handle().pipe(
      concatMap(async (responseBody) => {
        const statusCode = res.statusCode || 200;
        await this.idempotencyService.complete(recordId, statusCode, responseBody);
        return responseBody;
      }),
      catchError((error) => {
        this.idempotencyService.fail(recordId).catch(() => {});
        return throwError(() => error);
      }),
    );
  }
}
