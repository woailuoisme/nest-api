import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DrizzleIdempotencyStore } from '@/common/idempotency/drizzle-idempotency.store';
import { Idempotent } from '@/common/idempotency/idempotency.decorator';
import { IdempotencyModule } from '@/common/idempotency/idempotency.module';
import {
  type AcquireResult,
  canonicalize,
  canonicalStringify,
  DISALLOWED_REPLAY_HEADERS,
  IDEMPOTENCY_KEY_PATTERN,
  IdempotencyService,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  type StoredIdempotencyData,
} from '@/common/idempotency/idempotency.service';
import * as IdempotencyIndex from '@/common/idempotency/index';

import { createMockDrizzleDb } from '../../mocks/drizzle.mock';

describe('Idempotency Module & Exports', () => {
  it('场景 1: 验证 index.ts 是否正确导出幂等基础设施的所有核心常量、装饰器和服务', () => {
    expect(IdempotencyIndex.Idempotent).toBe(Idempotent);
    expect(IdempotencyIndex.IdempotencyService).toBe(IdempotencyService);
    expect(IdempotencyIndex.DrizzleIdempotencyStore).toBe(DrizzleIdempotencyStore);
    expect(IdempotencyIndex.IdempotencyModule).toBe(IdempotencyModule);
    expect(IdempotencyIndex.canonicalStringify).toBe(canonicalStringify);
    expect(IdempotencyIndex.canonicalize).toBe(canonicalize);
    expect(IdempotencyIndex.MAX_IDEMPOTENCY_KEY_LENGTH).toBe(MAX_IDEMPOTENCY_KEY_LENGTH);
    expect(IdempotencyIndex.IDEMPOTENCY_KEY_PATTERN).toBe(IDEMPOTENCY_KEY_PATTERN);
    expect(IdempotencyIndex.DISALLOWED_REPLAY_HEADERS).toBe(DISALLOWED_REPLAY_HEADERS);
  });

  it('场景 2: 验证 IdempotencyModule 正确配置 providers 和 exports 数组，确保模块可安全消费', () => {
    const moduleMetadata = Reflect.getMetadata('providers', IdempotencyModule);
    const exportsMetadata = Reflect.getMetadata('exports', IdempotencyModule);

    expect(moduleMetadata).toContain(DrizzleIdempotencyStore);
    expect(moduleMetadata).toContain(IdempotencyService);
    expect(exportsMetadata).toContain(DrizzleIdempotencyStore);
    expect(exportsMetadata).toContain(IdempotencyService);
  });
});

describe('Idempotent Decorator', () => {
  class TestController {
    @Idempotent()
    defaultMethod() {}

    @Idempotent({
      ttl: '60s',
      required: true,
      lockTtl: '15s',
      retryAfter: '2s',
    })
    customMethod() {}
  }

  @Idempotent({ ttl: '5m' })
  class TestClassController {}

  it('场景 3: 无参调用 @Idempotent() 时，方法元数据上挂载默认空配置对象', () => {
    const metadata = Reflect.getMetadata('nestjs:idempotent', TestController.prototype.defaultMethod);
    expect(metadata).toEqual({});
  });

  it('场景 4: 全参数定制（TTL、锁租期、重试间隔）正确挂载至方法元数据', () => {
    const metadata = Reflect.getMetadata('nestjs:idempotent', TestController.prototype.customMethod);
    expect(metadata).toEqual({
      ttl: 60000,
      required: true,
      lockTtl: 15000,
      retryAfter: 2000,
    });
  });

  it('场景 5: 支持在 Controller 类上声明类级别统一幂等策略，供整个控制器内的所有端点继承', () => {
    const metadata = Reflect.getMetadata('nestjs:idempotent', TestClassController);
    expect(metadata).toEqual({ ttl: 300000 });
  });
});

describe('Canonical JSON & Deterministic Hashing', () => {
  it('场景 6: 基础类型规范化 - 验证 null、undefined、数字、字符串、布尔值及未包装纯文本的基础处理', () => {
    expect(canonicalize(null)).toBeNull();
    expect(canonicalize(123)).toBe(123);
    expect(canonicalize('text')).toBe('text');
    expect(canonicalize(true)).toBe(true);
    expect(canonicalStringify(null)).toBe('{}');
    expect(canonicalStringify(undefined)).toBe('{}');
    expect(canonicalStringify('raw-string')).toBe('raw-string');
  });

  it('场景 7: Date 实例统一序列化为标准 ISO 8601 UTC 字符串，保障时间哈希跨环境确定性', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(canonicalize(d)).toBe('2026-01-01T00:00:00.000Z');
    expect(canonicalStringify({ time: d })).toBe('{"time":"2026-01-01T00:00:00.000Z"}');
  });

  it('场景 8: 多层嵌套对象即便键声明乱序，递归排序后生成完全一致的 JSON 字符串', () => {
    const objA = { z: 1, a: 2, m: { y: 'nested-y', b: 'nested-b' } };
    const objB = { a: 2, m: { b: 'nested-b', y: 'nested-y' }, z: 1 };

    const strA = canonicalStringify(objA);
    const strB = canonicalStringify(objB);

    expect(strA).toBe(strB);
    expect(strA).toBe('{"a":2,"m":{"b":"nested-b","y":"nested-y"},"z":1}');
  });

  it('场景 9: 保持数组元素原始物理顺序，同时递归排序数组内部每个对象的属性', () => {
    const arrA = [
      { beta: 2, alpha: 1 },
      { delta: 4, gamma: 3 },
    ];
    const arrB = [
      { alpha: 1, beta: 2 },
      { gamma: 3, delta: 4 },
    ];

    expect(canonicalStringify(arrA)).toBe(canonicalStringify(arrB));
    expect(canonicalStringify(arrA)).toBe('[{"alpha":1,"beta":2},{"delta":4,"gamma":3}]');

    // Array element order should matter
    const reversed = [
      { gamma: 3, delta: 4 },
      { alpha: 1, beta: 2 },
    ];
    expect(canonicalStringify(arrA)).not.toBe(canonicalStringify(reversed));
  });

  it('场景 10: 循环引用安全防爆栈 - 使用 WeakSet 探测循环引用并标记为 [Circular]', () => {
    const circular: any = { a: 1 };
    circular.self = circular;

    const result = canonicalStringify(circular);
    expect(result).toContain('"self":"[Circular]"');
  });

  it('场景 11: 与原生 JSON.stringify 保持一致，自动丢弃对象中的 undefined、函数和 Symbol 字段', () => {
    const complex = {
      valid: 'yes',
      fn: () => {},
      sym: Symbol('sym'),
      und: undefined,
    };
    expect(canonicalStringify(complex)).toBe('{"valid":"yes"}');
  });

  it('场景 12: 当遇到极端反射拦截或 Proxy 异常时，平滑降级至原生 JSON.stringify', () => {
    let callCount = 0;
    const obj = new Proxy(
      { fallback: true },
      {
        ownKeys(target) {
          callCount++;
          if (callCount === 1) {
            throw new Error('simulated canonicalize error');
          }
          return Reflect.ownKeys(target);
        },
      },
    );

    expect(canonicalStringify(obj)).toBe('{"fallback":true}');
  });

  it('场景 13: 顶层传入单独的函数或 Symbol 时，JSON.stringify 返回 undefined，安全兜底为 "{}"', () => {
    expect(canonicalStringify(() => {})).toBe('{}');
    expect(canonicalStringify(Symbol('test'))).toBe('{}');
  });
});

/**
 * DrizzleIdempotencyStore 依赖桩：模拟底层数据库原子认领、完成与释放契约
 */
function createMockIdempotencyStore() {
  const store = {
    acquire: vi.fn(),
    complete: vi.fn(),
    release: vi.fn(),
    extend: vi.fn(),
    hashKey: vi.fn((k: string) => `hash_${k}`),
  };
  return store as unknown as DrizzleIdempotencyStore & {
    acquire: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    extend: ReturnType<typeof vi.fn>;
    hashKey: ReturnType<typeof vi.fn>;
  };
}

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let mockStore: ReturnType<typeof createMockIdempotencyStore>;

  beforeEach(() => {
    mockStore = createMockIdempotencyStore();
    service = new IdempotencyService(mockStore);
  });

  describe('validateIdempotencyKey', () => {
    it('场景 14: 客户端传入空字符串幂等键，拦截并抛出 BadRequestException', () => {
      expect(() => service.validateIdempotencyKey('')).toThrow(
        new BadRequestException('Idempotency-Key header cannot be empty'),
      );
    });

    it('场景 15: 幂等键超过 256 字符上限，防止恶意撑爆缓存键，拒绝并抛出 BadRequestException', () => {
      const longKey = 'a'.repeat(257);
      expect(() => service.validateIdempotencyKey(longKey)).toThrow(
        new BadRequestException('Idempotency-Key header must not exceed 256 characters'),
      );
    });

    it('场景 16: 含有空格、换行符、Tab 或 Emoji 等非可见 ASCII 字符，拒绝并抛出 BadRequestException', () => {
      expect(() => service.validateIdempotencyKey('key with space')).toThrow(BadRequestException);
      expect(() => service.validateIdempotencyKey('key\nnewline')).toThrow(BadRequestException);
      expect(() => service.validateIdempotencyKey('key\twith\ttab')).toThrow(BadRequestException);
      expect(() => service.validateIdempotencyKey('key-🔥-emoji')).toThrow(BadRequestException);
    });

    it('场景 17: 符合标准格式（UUID、自定义前缀业务键、256 字符边界值）的 Key 顺利通过校验', () => {
      expect(() => service.validateIdempotencyKey('req_123456')).not.toThrow();
      expect(() => service.validateIdempotencyKey('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d')).not.toThrow();
      expect(() => service.validateIdempotencyKey('user:1:action:checkout_2026-09-11')).not.toThrow();
      expect(() => service.validateIdempotencyKey('a'.repeat(256))).not.toThrow();
    });
  });

  describe('isCacheableStatusCode', () => {
    it('场景 18: 默认策略对 200, 201, 204 等成功响应判定为可缓存', () => {
      expect(service.isCacheableStatusCode(200)).toBe(true);
      expect(service.isCacheableStatusCode(201)).toBe(true);
      expect(service.isCacheableStatusCode(204)).toBe(true);
    });

    it('场景 19: 默认策略对 400, 401, 402, 403, 404, 422 等确定性 4xx 客户端错误进行幂等缓存', () => {
      expect(service.isCacheableStatusCode(400)).toBe(true);
      expect(service.isCacheableStatusCode(401)).toBe(true);
      expect(service.isCacheableStatusCode(402)).toBe(true);
      expect(service.isCacheableStatusCode(403)).toBe(true);
      expect(service.isCacheableStatusCode(404)).toBe(true);
      expect(service.isCacheableStatusCode(422)).toBe(true);
    });

    it('场景 20: 409 Conflict 与 429 Too Many Requests 瞬态并发与限流错误严禁缓存', () => {
      expect(service.isCacheableStatusCode(409)).toBe(false);
      expect(service.isCacheableStatusCode(429)).toBe(false);
    });

    it('场景 21: 500, 502, 503, 504 等 5xx 服务端故障严禁缓存以保障重试', () => {
      expect(service.isCacheableStatusCode(500)).toBe(false);
      expect(service.isCacheableStatusCode(502)).toBe(false);
      expect(service.isCacheableStatusCode(503)).toBe(false);
      expect(service.isCacheableStatusCode(504)).toBe(false);
    });

    it('场景 22: 301, 302 等 3xx 重定向响应由客户端链路处理，默认不予幂等缓存', () => {
      expect(service.isCacheableStatusCode(301)).toBe(false);
      expect(service.isCacheableStatusCode(302)).toBe(false);
    });

    it('场景 23: 传入 customCodes 白名单时，严格按照显式声明的白名单执行匹配', () => {
      const custom = [201, 400];
      expect(service.isCacheableStatusCode(200, custom)).toBe(false);
      expect(service.isCacheableStatusCode(201, custom)).toBe(true);
      expect(service.isCacheableStatusCode(400, custom)).toBe(true);
      expect(service.isCacheableStatusCode(422, custom)).toBe(false);
    });
  });

  describe('sanitizeHeadersForReplay', () => {
    it('场景 24: 响应头为 null 或 undefined 时，安全返回空对象', () => {
      expect(service.sanitizeHeadersForReplay(null)).toEqual({});
      expect(service.sanitizeHeadersForReplay(undefined)).toEqual({});
    });

    it('场景 25: 大小写无关地剥离 Hop-by-hop 网络逐跳头及 Set-Cookie、Authorization 敏感凭据头', () => {
      const originalHeaders = {
        'Content-Type': 'application/json',
        Connection: 'keep-alive',
        'Keep-Alive': 'timeout=5',
        'Transfer-Encoding': 'chunked',
        'Set-Cookie': 'session=secret; HttpOnly',
        'set-cookie': 'another=123',
        Authorization: 'Bearer abc',
        'X-Idempotency-Replayed': 'false',
        'X-Custom-Header': 'custom-value',
      };

      const clean = service.sanitizeHeadersForReplay(originalHeaders);

      expect(clean).toEqual({
        'Content-Type': 'application/json',
        'X-Custom-Header': 'custom-value',
      });
      expect(clean['Set-Cookie']).toBeUndefined();
      expect(clean['set-cookie']).toBeUndefined();
      expect(clean.Connection).toBeUndefined();
      expect(clean['Transfer-Encoding']).toBeUndefined();
    });
  });

  describe('computePayloadHash', () => {
    it('场景 26: 不同键插入顺序的 JSON 请求体通过规范化产生完全相同的 64 位 SHA-256 摘要', () => {
      const hash1 = service.computePayloadHash({ amount: 100, currency: 'USD', metadata: { fee: 5, tax: 1 } });
      const hash2 = service.computePayloadHash({ currency: 'USD', metadata: { tax: 1, fee: 5 }, amount: 100 });
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('场景 27: 不同内容载荷产生完全不同的哈希值，确保防篡改指纹强隔离', () => {
      const hash1 = service.computePayloadHash({ amount: 100 });
      const hash2 = service.computePayloadHash({ amount: 200 });
      expect(hash1).not.toBe(hash2);
    });

    it('场景 28: 对 null、undefined 及普通字符串类型提供确定性的 SHA-256 摘要', () => {
      const hashNull = service.computePayloadHash(null);
      const hashUndefined = service.computePayloadHash(undefined);
      expect(hashNull).toBe(hashUndefined);

      const strHash = service.computePayloadHash('simple-text');
      expect(strHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('buildCacheKey and buildLockKey', () => {
    it('场景 29: 规范化组装分布式缓存键与分布式互斥锁键，确保租户与业务键严格隔离', () => {
      const cacheKey = service.buildCacheKey('user:123', 'req-uuid');
      const lockKey = service.buildLockKey('user:123', 'req-uuid');
      expect(cacheKey).toBe('idempotency:cache:user:123:req-uuid');
      expect(lockKey).toBe('idempotency:lock:user:123:req-uuid');
    });
  });

  describe('acquire', () => {
    const acquireParams = {
      key: 'key-1',
      actor: 'user:1',
      requestPath: '/v1/orders',
      payloadHash: 'hash-payload-123',
      ttlSeconds: 3600,
      lockTtlMs: 10000,
      waitTimeoutMs: 1000,
      retryIntervalMs: 20,
    };

    it('场景 30: 首次请求且底层 Store 抢占租约锁成功（state: acquired），返回 acquired: true 与 lockToken', async () => {
      mockStore.acquire.mockResolvedValueOnce({ state: 'acquired' });

      const result = await service.acquire(acquireParams);

      expect(result.acquired).toBe(true);
      if (result.acquired) {
        expect(result.lockToken).toBeDefined();
        expect(result.cacheKey).toBe('idempotency:cache:user:1:key-1');
        expect(result.lockKey).toBe('idempotency:lock:user:1:key-1');
      }
      expect(mockStore.acquire).toHaveBeenCalledWith(
        'user:1:key-1',
        expect.any(String),
        `${acquireParams.requestPath}:${acquireParams.payloadHash}`,
        acquireParams.lockTtlMs,
      );
    });

    it('场景 31: 存在已完成记录（state: completed）且 requestPath 与 payloadHash 均严格匹配，返回回放数据且不竞争锁', async () => {
      mockStore.acquire.mockResolvedValueOnce({
        state: 'completed',
        fingerprint: `${acquireParams.requestPath}:${acquireParams.payloadHash}`,
        response: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: { orderId: 'ord-1' },
        },
      });

      const result = await service.acquire(acquireParams);

      expect(result.acquired).toBe(false);
      if (!result.acquired && !result.bypass) {
        expect(result.cached).toEqual({
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: { orderId: 'ord-1' },
        });
      }
    });

    it('场景 32: 同一幂等键被用于不同请求路径时，检测出语义冲突并直抛 422 UnprocessableEntityException', async () => {
      mockStore.acquire.mockResolvedValueOnce({
        state: 'completed',
        fingerprint: `/v1/different-orders:${acquireParams.payloadHash}`,
        response: { status: 200, headers: {}, body: {} },
      });

      await expect(service.acquire(acquireParams)).rejects.toThrow(
        new UnprocessableEntityException('Idempotency key path mismatch'),
      );
    });

    it('场景 33: 同一幂等键被用于不同 Payload 时，检测出载荷指纹不符并直抛 422 UnprocessableEntityException', async () => {
      mockStore.acquire.mockResolvedValueOnce({
        state: 'completed',
        fingerprint: `${acquireParams.requestPath}:different-payload-hash`,
        response: { status: 200, headers: {}, body: {} },
      });

      await expect(service.acquire(acquireParams)).rejects.toThrow(
        new UnprocessableEntityException('Idempotency key payload mismatch'),
      );
    });

    it('场景 34: 底层 Store 异常且配置 fallback 为 fail-open 时，安全降级返回 bypass: true 保证业务不中断', async () => {
      mockStore.acquire.mockRejectedValueOnce(new Error('DB failure'));

      const result = await service.acquire({
        ...acquireParams,
        fallback: 'fail-open',
      });

      expect(result).toEqual({ acquired: false, bypass: true });
    });

    it('场景 35: 并发请求在超时窗口内自旋重试，等到先发请求完成写入后立刻读取并返回回放', async () => {
      mockStore.acquire
        .mockResolvedValueOnce({
          state: 'in-flight',
          fingerprint: `${acquireParams.requestPath}:${acquireParams.payloadHash}`,
        })
        .mockResolvedValueOnce({
          state: 'in-flight',
          fingerprint: `${acquireParams.requestPath}:${acquireParams.payloadHash}`,
        })
        .mockResolvedValueOnce({
          state: 'completed',
          fingerprint: `${acquireParams.requestPath}:${acquireParams.payloadHash}`,
          response: {
            status: 201,
            headers: {},
            body: { created: true },
          },
        });

      const result = await service.acquire({
        ...acquireParams,
        waitTimeoutMs: 1000,
        retryIntervalMs: 10,
      });

      expect(result.acquired).toBe(false);
      if (!result.acquired && !result.bypass) {
        expect(result.cached.statusCode).toBe(201);
        expect(result.cached.body).toEqual({ created: true });
      }
    });

    it('场景 36: 先发请求因异常释放锁（未写入缓存），自旋重试的请求成功竞争到锁并接管执行', async () => {
      mockStore.acquire
        .mockResolvedValueOnce({
          state: 'in-flight',
          fingerprint: `${acquireParams.requestPath}:${acquireParams.payloadHash}`,
        })
        .mockResolvedValueOnce({
          state: 'in-flight',
          fingerprint: `${acquireParams.requestPath}:${acquireParams.payloadHash}`,
        })
        .mockResolvedValueOnce({ state: 'acquired' });

      const result = await service.acquire({
        ...acquireParams,
        waitTimeoutMs: 1000,
        retryIntervalMs: 10,
      });

      expect(result.acquired).toBe(true);
    });

    it('场景 37: 在指定的 waitTimeoutMs 窗口内锁一直处于 in-flight 且无缓存产出，抛出 409 ConflictException', async () => {
      mockStore.acquire.mockResolvedValue({
        state: 'in-flight',
        fingerprint: `${acquireParams.requestPath}:${acquireParams.payloadHash}`,
      });

      await expect(
        service.acquire({
          ...acquireParams,
          waitTimeoutMs: 50,
          retryIntervalMs: 10,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('场景 38: 底层 Store 连接失败时，默认 fail-closed 模式抛出 503 ServiceUnavailableException', async () => {
      mockStore.acquire.mockRejectedValueOnce(new Error('PostgreSQL connection refused'));

      await expect(
        service.acquire({
          ...acquireParams,
          fallback: 'fail-closed',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('场景 39: 校验不同 actor（用户/访客/租户）对同一 key 生成隔离的 scopedKey 传递到底层 store', async () => {
      mockStore.acquire.mockResolvedValueOnce({ state: 'acquired' });

      await service.acquire({
        ...acquireParams,
        actor: 'user:456',
        key: 'order-pay',
      });

      expect(mockStore.acquire).toHaveBeenCalledWith(
        'user:456:order-pay',
        expect.any(String),
        expect.any(String),
        expect.any(Number),
      );
    });
  });

  describe('complete', () => {
    it('场景 40: 响应状态码、头部和响应体持久化至底层 Store，并通过 CAS 校验 Token 安全解绑 Owner', async () => {
      mockStore.complete.mockResolvedValueOnce(true);

      await service.complete({
        cacheKey: 'idempotency:cache:user:1:key-1',
        lockKey: 'idempotency:lock:user:1:key-1',
        lockToken: 'token-1',
        requestPath: '/v1/items',
        payloadHash: 'hash-1',
        statusCode: 200,
        responseBody: { ok: true },
        responseHeaders: { 'x-res': 'header' },
        ttlSeconds: 7200,
      });

      expect(mockStore.complete).toHaveBeenCalledWith(
        'user:1:key-1',
        'token-1',
        { status: 200, headers: { 'x-res': 'header' }, body: { ok: true } },
        7200 * 1000,
      );
    });

    it('场景 41: complete 阶段存储异常时应 fail-closed 上抛 503，禁止上游误判为已落库', async () => {
      mockStore.complete.mockRejectedValueOnce(new Error('DB disconnect'));

      await expect(
        service.complete({
          cacheKey: 'idempotency:cache:user:1:key-1',
          lockKey: 'idempotency:lock:user:1:key-1',
          lockToken: 'token-1',
          requestPath: '/v1/items',
          payloadHash: 'hash-1',
          statusCode: 500,
          responseBody: {},
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('场景 41b: CAS 未命中（租约过期或被其他副本接管）时应上抛 503 而非静默成功', async () => {
      mockStore.complete.mockResolvedValueOnce(false);

      await expect(
        service.complete({
          cacheKey: 'idempotency:cache:user:1:key-1',
          lockKey: 'idempotency:lock:user:1:key-1',
          lockToken: 'token-1',
          requestPath: '/v1/items',
          payloadHash: 'hash-1',
          statusCode: 200,
          responseBody: { ok: true },
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('fail and releaseLock', () => {
    it('场景 42: 下游业务执行失败时，调用 release 主动归还租约互斥锁', async () => {
      mockStore.release.mockResolvedValueOnce(true);

      await service.fail({
        lockKey: 'idempotency:lock:user:1:key-f',
        lockToken: 'token-f',
      });

      expect(mockStore.release).toHaveBeenCalledWith('user:1:key-f', 'token-f');
    });

    it('场景 43: release 释放锁执行失败时，安全捕获并记录 Warn 日志而不阻断主流程', async () => {
      mockStore.release.mockRejectedValueOnce(new Error('DB disconnect'));

      await expect(
        service.fail({
          lockKey: 'idempotency:lock:user:1:key-f',
          lockToken: 'token-f',
        }),
      ).resolves.not.toThrow();
    });

    it('场景 43b: 启动锁续租心跳并在定时器触发时调用 store.extend 延展租约', async () => {
      vi.useFakeTimers();
      mockStore.extend.mockResolvedValue(true);

      const stop = service.startLockHeartbeat({
        lockKey: 'idempotency:lock:user:1:key-hb',
        lockToken: 'token-hb',
        lockTtlMs: 3000,
      });

      vi.advanceTimersByTime(1000);
      expect(mockStore.extend).toHaveBeenCalledWith('user:1:key-hb', 'token-hb', 3000);

      stop();
      vi.useRealTimers();
    });

    it('场景 43c: 续租 CAS 未命中（已失锁）时应停止心跳，不再继续空转续租', async () => {
      vi.useFakeTimers();
      try {
        mockStore.extend.mockResolvedValue(false);

        service.startLockHeartbeat({
          lockKey: 'idempotency:lock:user:1:key-hb2',
          lockToken: 'token-hb2',
          lockTtlMs: 3000,
        });

        await vi.advanceTimersByTimeAsync(1000);
        expect(mockStore.extend).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(3000);
        expect(mockStore.extend).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('Idempotency Storage Registration', () => {
  it('场景 44: DrizzleIdempotencyStore 正确注册为 IdempotencyStorage 的底层数据源', async () => {
    const { IdempotencyStorage } = await import('@nestjs/idempotency');
    const storage = new IdempotencyStorage();
    const mockDb = createMockDrizzleDb();
    const store = new DrizzleIdempotencyStore(mockDb, storage);
    expect(storage.source).toBe(store);
  });
});

describe('DrizzleIdempotencyStore', () => {
  let store: DrizzleIdempotencyStore;
  let mockDb: any;

  beforeEach(() => {
    mockDb = createMockDrizzleDb();
    store = new DrizzleIdempotencyStore(mockDb);
  });

  it('场景 66: hashKey 产生确定性的 64 位十六进制 SHA-256 字符串', () => {
    const hash1 = store.hashKey('test-key');
    const hash2 = store.hashKey('test-key');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('场景 67: acquire - 成功插入新记录时返回 state = acquired', async () => {
    mockDb._stubs.insertReturning.mockResolvedValueOnce([{ keyHash: 'dummy' }]);
    const res = await store.acquire('user:1:key', 'token-1', '/api/test:hash', 30000);
    expect(res).toEqual({ state: 'acquired' });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('场景 68: acquire - 冲突且现有记录属于进行中时返回 state = in-flight', async () => {
    mockDb._stubs.insertReturning.mockResolvedValueOnce([]); // 插入冲突
    mockDb.query.idempotencyKeys.findFirst.mockResolvedValueOnce({
      keyHash: 'dummy',
      owner: 'token-other',
      fingerprint: '/api/test:hash',
      expiresAt: Date.now() + 10000,
      response: null,
    });

    const res = await store.acquire('user:1:key', 'token-1', '/api/test:hash', 30000);
    expect(res).toEqual({ state: 'in-flight', fingerprint: '/api/test:hash' });
  });

  it('场景 69: acquire - 冲突且现有记录已完成时返回 state = completed 并携带响应体', async () => {
    mockDb._stubs.insertReturning.mockResolvedValueOnce([]); // 插入冲突
    mockDb.query.idempotencyKeys.findFirst.mockResolvedValueOnce({
      keyHash: 'dummy',
      owner: null,
      fingerprint: '/api/test:hash',
      expiresAt: Date.now() + 86400000,
      response: { status: 200, body: { success: true } },
    });

    const res = await store.acquire('user:1:key', 'token-1', '/api/test:hash', 30000);
    expect(res).toEqual({
      state: 'completed',
      fingerprint: '/api/test:hash',
      response: { status: 200, body: { success: true } },
    });
  });

  it('场景 67c: 租约写入与可见性谓词必须使用 DB 时钟表达式（防回退到应用时钟 Date.now）', async () => {
    mockDb._stubs.insertReturning.mockResolvedValueOnce([{ keyHash: 'dummy' }]);
    await store.acquire('user:1:key', 'token-1', '/api/test:hash', 30000);

    const [values] = mockDb._stubs.insertValues.mock.calls[0] as [Record<string, unknown>];
    expect(values.expiresAt).toBeInstanceOf(SQL);

    const [upsert] = mockDb._stubs.onConflictDoUpdate.mock.calls[0] as [Record<string, unknown>];
    expect(upsert.setWhere).toBeInstanceOf(SQL);
    expect((upsert.set as Record<string, unknown>).expiresAt).toBeInstanceOf(SQL);
  });

  it('场景 67b: acquire - 回查发现记录已被并发释放时仅重试一次，预算耗尽即抛错（杜绝无限递归）', async () => {
    mockDb._stubs.insertReturning.mockResolvedValue([]); // 插入恒冲突
    mockDb.query.idempotencyKeys.findFirst.mockResolvedValue(null); // 回查恒为空

    await expect(store.acquire('user:1:key', 'token-1', '/api/test:hash', 30000)).rejects.toThrow(/retry exhausted/);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('场景 67d: 回查命中「已过期」行时应重试抢占，而非误报 in-flight（避免上层白等 409）', async () => {
    mockDb._stubs.insertReturning.mockResolvedValueOnce([]); // 首次 UPSERT 未命中
    mockDb.query.idempotencyKeys.findFirst.mockResolvedValueOnce({
      keyHash: 'dummy',
      owner: 'stale-owner',
      fingerprint: '/api/test:hash',
      expiresAt: 1,
      expired: true,
      response: null,
    });
    mockDb._stubs.insertReturning.mockResolvedValueOnce([{ keyHash: 'dummy' }]); // 重试后抢占成功

    const res = await store.acquire('user:1:key', 'token-1', '/api/test:hash', 30000);

    expect(res).toEqual({ state: 'acquired' });
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('场景 70: complete - 执行 CAS 更新并返回更新结果', async () => {
    mockDb._stubs.updateReturning.mockResolvedValueOnce([{ keyHash: 'dummy' }]);
    const ok = await store.complete('user:1:key', 'token-1', { status: 200, body: {} } as any, 86400000);
    expect(ok).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('场景 71: release - 执行 CAS 删除并返回删除结果', async () => {
    mockDb._stubs.deleteReturning.mockResolvedValueOnce([{ keyHash: 'dummy' }]);
    const ok = await store.release('user:1:key', 'token-1');
    expect(ok).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('场景 72: extend - 执行 CAS 续租并返回结果', async () => {
    mockDb._stubs.updateReturning.mockResolvedValueOnce([{ keyHash: 'dummy' }]);
    const ok = await store.extend('user:1:key', 'token-1', 15000);
    expect(ok).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });
});
