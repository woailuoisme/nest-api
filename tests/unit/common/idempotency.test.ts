import {
  BadRequestException,
  ConflictException,
  type ExecutionContext,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IDEMPOTENT_KEY, Idempotent } from '@/common/idempotency/idempotency.decorator';
import { IdempotencyInterceptor } from '@/common/idempotency/idempotency.interceptor';
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
import type { RedisService } from '@/database/redis.service';

describe('Idempotency Module & Exports', () => {
  it('场景 1: 验证 index.ts 是否正确导出幂等基础设施的所有核心常量、装饰器、拦截器和序列化工具', () => {
    expect(IdempotencyIndex.IDEMPOTENT_KEY).toBe(IDEMPOTENT_KEY);
    expect(IdempotencyIndex.Idempotent).toBe(Idempotent);
    expect(IdempotencyIndex.IdempotencyInterceptor).toBe(IdempotencyInterceptor);
    expect(IdempotencyIndex.IdempotencyService).toBe(IdempotencyService);
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

    expect(moduleMetadata).toContain(IdempotencyService);
    expect(moduleMetadata).toContain(IdempotencyInterceptor);
    expect(exportsMetadata).toContain(IdempotencyService);
    expect(exportsMetadata).toContain(IdempotencyInterceptor);
  });
});

describe('Idempotent Decorator', () => {
  class TestController {
    @Idempotent()
    defaultMethod() {}

    @Idempotent({
      ttlSeconds: 60,
      required: true,
      waitTimeoutMs: 2000,
      lockTtlMs: 15000,
      fallback: 'fail-open',
      cacheStatusCodes: [200, 201],
    })
    customMethod() {}
  }

  @Idempotent({ ttlSeconds: 300, fallback: 'fail-closed' })
  class TestClassController {}

  it('场景 3: 无参调用 @Idempotent() 时，方法元数据上挂载默认空配置对象', () => {
    const metadata = Reflect.getMetadata(IDEMPOTENT_KEY, TestController.prototype.defaultMethod);
    expect(metadata).toEqual({});
  });

  it('场景 4: 全参数定制（TTL、超时阈值、锁租期、容灾降级模式、状态码白名单）正确挂载至方法元数据', () => {
    const metadata = Reflect.getMetadata(IDEMPOTENT_KEY, TestController.prototype.customMethod);
    expect(metadata).toEqual({
      ttlSeconds: 60,
      required: true,
      waitTimeoutMs: 2000,
      lockTtlMs: 15000,
      fallback: 'fail-open',
      cacheStatusCodes: [200, 201],
    });
  });

  it('场景 5: 支持在 Controller 类上声明类级别统一幂等策略，供整个控制器内的所有端点继承', () => {
    const metadata = Reflect.getMetadata(IDEMPOTENT_KEY, TestClassController);
    expect(metadata).toEqual({ ttlSeconds: 300, fallback: 'fail-closed' });
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
 * Redis 依赖桩：IdempotencyService 仅用到 getClient() 暴露的 set/get/eval 与 key() 命名空间拼接，
 * 统一在此构造，避免多个 describe 重复声明同一套 mock 形状与类型转型。
 */
function createMockIdempotencyRedis() {
  const client = {
    set: vi.fn(),
    get: vi.fn(),
    eval: vi.fn(),
  };
  const redis = {
    getClient: vi.fn(() => client),
    key: vi.fn((...args: string[]) => args.join(':')),
  };
  return { client, redis: redis as unknown as RedisService };
}

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let mockRedisClient: any;

  beforeEach(() => {
    const { client, redis } = createMockIdempotencyRedis();
    mockRedisClient = client;
    service = new IdempotencyService(redis);
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

    it('场景 30: 缓存不存在且分布式互斥锁成功获取（SET NX），返回 acquired: true 与 lockToken', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.set.mockResolvedValueOnce('OK');

      const result = await service.acquire(acquireParams);

      expect(result.acquired).toBe(true);
      if (result.acquired) {
        expect(result.lockToken).toBeDefined();
        expect(result.cacheKey).toBe('idempotency:cache:user:1:key-1');
        expect(result.lockKey).toBe('idempotency:lock:user:1:key-1');
      }
    });

    it('场景 31: 缓存存在且 requestPath 与 payloadHash 均严格匹配，返回回放数据且不竞争锁', async () => {
      const storedData: StoredIdempotencyData = {
        requestPath: acquireParams.requestPath,
        payloadHash: acquireParams.payloadHash,
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: { orderId: 'ord-1' },
      };

      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(storedData));

      const result = await service.acquire(acquireParams);

      expect(result.acquired).toBe(false);
      if (!result.acquired && !result.bypass) {
        expect(result.cached).toEqual({
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: { orderId: 'ord-1' },
        });
      }
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('场景 32: 同一幂等键被用于不同请求路径时，检测出语义冲突并直抛 422 UnprocessableEntityException', async () => {
      const storedData: StoredIdempotencyData = {
        requestPath: '/v1/different-orders',
        payloadHash: acquireParams.payloadHash,
        statusCode: 200,
        body: {},
      };

      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(storedData));

      await expect(service.acquire(acquireParams)).rejects.toThrow(
        new UnprocessableEntityException('Idempotency key path mismatch'),
      );
    });

    it('场景 33: 同一幂等键被用于不同 Payload 时，检测出载荷指纹不符并直抛 422 UnprocessableEntityException', async () => {
      const storedData: StoredIdempotencyData = {
        requestPath: acquireParams.requestPath,
        payloadHash: 'different-payload-hash',
        statusCode: 200,
        body: {},
      };

      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(storedData));

      await expect(service.acquire(acquireParams)).rejects.toThrow(
        new UnprocessableEntityException('Idempotency key payload mismatch'),
      );
    });

    it('场景 34: Redis 中缓存数据损坏（非合规 JSON），记录告警并平滑降级重新加锁执行', async () => {
      mockRedisClient.get.mockResolvedValueOnce('invalid-json{');
      mockRedisClient.set.mockResolvedValueOnce('OK');

      const result = await service.acquire(acquireParams);

      expect(result.acquired).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalled();
    });

    it('场景 35: 并发请求在超时窗口内自旋重试，等到先发请求完成写入后立刻读取并返回回放', async () => {
      mockRedisClient.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          JSON.stringify({
            requestPath: acquireParams.requestPath,
            payloadHash: acquireParams.payloadHash,
            statusCode: 201,
            body: { created: true },
          }),
        );

      mockRedisClient.set.mockResolvedValue(null);

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
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.set.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('OK');

      const result = await service.acquire({
        ...acquireParams,
        waitTimeoutMs: 1000,
        retryIntervalMs: 10,
      });

      expect(result.acquired).toBe(true);
    });

    it('场景 37: 在指定的 waitTimeoutMs 窗口内锁一直未释放且无缓存产出，抛出 409 ConflictException', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.set.mockResolvedValue(null);

      await expect(
        service.acquire({
          ...acquireParams,
          waitTimeoutMs: 50,
          retryIntervalMs: 10,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('场景 38: Redis 连接失败时，默认 fail-closed 模式抛出 503 ServiceUnavailableException', async () => {
      mockRedisClient.get.mockRejectedValueOnce(new Error('Redis connection refused'));

      await expect(
        service.acquire({
          ...acquireParams,
          fallback: 'fail-closed',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('场景 39: 配置 fallback 为 fail-open 时，Redis 异常安全降级返回 bypass: true 保证业务不中断', async () => {
      mockRedisClient.get.mockRejectedValueOnce(new Error('Redis timeout'));

      const result = await service.acquire({
        ...acquireParams,
        fallback: 'fail-open',
      });

      expect(result).toEqual({ acquired: false, bypass: true });
    });
  });

  describe('complete', () => {
    it('场景 40: 响应状态码、头部和响应体持久化至 Redis，并通过专用 Lua 脚本比对 token 安全解锁', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      await service.complete({
        cacheKey: 'cache-key-1',
        lockKey: 'lock-key-1',
        lockToken: 'token-1',
        requestPath: '/v1/items',
        payloadHash: 'hash-1',
        statusCode: 200,
        responseBody: { ok: true },
        responseHeaders: { 'x-res': 'header' },
        ttlSeconds: 7200,
      });

      expect(mockRedisClient.set).toHaveBeenCalledWith('cache-key-1', expect.stringContaining('200'), 'EX', 7200);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(expect.any(String), 1, 'lock-key-1', 'token-1');
    });

    it('场景 41: 写缓存阶段抛出异常时，finally 保障机制依然执行 Lua 脚本释放互斥锁杜绝死锁', async () => {
      mockRedisClient.set.mockRejectedValueOnce(new Error('Redis out of memory'));
      mockRedisClient.eval.mockResolvedValue(1);

      await service.complete({
        cacheKey: 'cache-key-1',
        lockKey: 'lock-key-1',
        lockToken: 'token-1',
        requestPath: '/v1/items',
        payloadHash: 'hash-1',
        statusCode: 500,
        responseBody: {},
      });

      expect(mockRedisClient.eval).toHaveBeenCalledWith(expect.any(String), 1, 'lock-key-1', 'token-1');
    });
  });

  describe('fail and releaseLock', () => {
    it('场景 42: 下游业务执行失败时，执行 Lua 解锁脚本主动让出互斥锁', async () => {
      mockRedisClient.eval.mockResolvedValueOnce(1);

      await service.fail({
        lockKey: 'lock-key-f',
        lockToken: 'token-f',
      });

      expect(mockRedisClient.eval).toHaveBeenCalledWith(expect.any(String), 1, 'lock-key-f', 'token-f');
    });

    it('场景 43: Redis 异常导致解锁脚本执行失败时，安全捕获并记录 Warn 日志而不阻断主流程', async () => {
      mockRedisClient.eval.mockRejectedValueOnce(new Error('Redis disconnect'));

      await expect(
        service.fail({
          lockKey: 'lock-key-f',
          lockToken: 'token-f',
        }),
      ).resolves.not.toThrow();
    });
  });
});

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let reflector: Reflector;
  let realService: IdempotencyService;
  let mockRedisClient: any;

  beforeEach(() => {
    const { client, redis } = createMockIdempotencyRedis();
    reflector = new Reflector();
    mockRedisClient = client;
    realService = new IdempotencyService(redis);
    interceptor = new IdempotencyInterceptor(reflector, realService);
  });

  function createMockContext(
    method = 'POST',
    headers: Record<string, any> = {},
    user?: any,
    ip = '127.0.0.1',
    url = '/v1/orders?filter=new',
    body: any = { total: 100 },
  ) {
    const req: any = {
      method,
      headers,
      url,
      ip,
      body,
      user,
    };
    const resHeaders: Record<string, any> = {};
    const res: any = {
      statusCode: 200,
      header: vi.fn((k: string, v: any) => {
        resHeaders[k.toLowerCase()] = v;
      }),
      status: vi.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      getHeaders: vi.fn(() => resHeaders),
    };

    const context: ExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => () => {},
      getClass: () => class {},
    } as unknown as ExecutionContext;

    return { context, req, res, resHeaders };
  }

  describe('HTTP Verb Filtering', () => {
    it('场景 44: GET、HEAD、OPTIONS 等只读安全动词即便携带 Idempotency-Key 也直接旁路放行', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext('GET', { 'idempotency-key': 'valid-key-1' });
      const next = { handle: () => of('bypass-get') };

      const obs = await interceptor.intercept(context, next);
      let emitted: any;
      obs.subscribe((val) => {
        emitted = val;
      });

      expect(emitted).toBe('bypass-get');
      expect(mockRedisClient.get).not.toHaveBeenCalled();
    });

    it('场景 45: 请求 HTTP Method 为空或未定义时，安全绕过幂等拦截', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context, req } = createMockContext('POST', { 'idempotency-key': 'valid-key-2' });
      req.method = undefined;
      const next = { handle: () => of('bypass-no-method') };

      const obs = await interceptor.intercept(context, next);
      let emitted: any;
      obs.subscribe((val) => {
        emitted = val;
      });

      expect(emitted).toBe('bypass-no-method');
      expect(mockRedisClient.get).not.toHaveBeenCalled();
    });

    it('场景 46: 支持处理小写 post、put、patch、delete 等变异动词，正常执行互斥锁与缓存写入', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext('post', { 'idempotency-key': 'key-post' });
      const next = { handle: () => of('post-ok') };

      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const obs = await interceptor.intercept(context, next);
      let emitted: any;
      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (val) => {
            emitted = val;
          },
          complete: () => resolve(),
        });
      });

      expect(emitted).toBe('post-ok');
      expect(mockRedisClient.set).toHaveBeenCalled();
    });
  });

  describe('Header Validation & Security Constraints', () => {
    it('场景 47: 默认非必填（required: false）时，未携带 Idempotency-Key 头部的请求直接透明通过', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext('POST', {});
      const next = { handle: () => of('pass-no-header') };

      const obs = await interceptor.intercept(context, next);
      let emitted: any;
      obs.subscribe((val) => {
        emitted = val;
      });

      expect(emitted).toBe('pass-no-header');
      expect(mockRedisClient.get).not.toHaveBeenCalled();
    });

    it('场景 48: required: true 模式下，未携带 Idempotency-Key 时直接阻断并抛出 400 BadRequestException', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ required: true });
      const { context } = createMockContext('POST', {});
      const next = { handle: () => of('fail') };

      await expect(interceptor.intercept(context, next)).rejects.toThrow(
        new BadRequestException('Idempotency-Key header is required for this operation'),
      );
    });

    it('场景 49: required: true 模式下，传入纯空格幂等键同样被判定为缺失并抛出 400 异常', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ required: true });
      const { context } = createMockContext('POST', { 'idempotency-key': '   ' });
      const next = { handle: () => of('fail') };

      await expect(interceptor.intercept(context, next)).rejects.toThrow(
        new BadRequestException('Idempotency-Key header is required for this operation'),
      );
    });

    it('场景 50: 幂等键包含空格等非法字符，被 service.validateIdempotencyKey 拦截并抛出 400', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext('POST', { 'idempotency-key': 'invalid key space' });
      const next = { handle: () => of('fail') };

      await expect(interceptor.intercept(context, next)).rejects.toThrow(BadRequestException);
    });

    it('场景 51: 幂等键长度超标超过 256 字符，被直接拦截并抛出 400 异常', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext('POST', { 'idempotency-key': 'a'.repeat(257) });
      const next = { handle: () => of('fail') };

      await expect(interceptor.intercept(context, next)).rejects.toThrow(
        new BadRequestException('Idempotency-Key header must not exceed 256 characters'),
      );
    });
  });

  describe('Scope Resolution and Fallback Options', () => {
    it('场景 52: 从 req.user.id 提取 actor 隔离租户，并将装饰器全量参数完整下发给 acquire', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        ttlSeconds: 600,
        lockTtlMs: 20000,
        waitTimeoutMs: 3000,
        fallback: 'fail-open',
      });
      const { context } = createMockContext('POST', { 'idempotency-key': 'k-actor' }, { id: 'user-777' });
      const next = { handle: () => of('user-ok') };

      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const acquireSpy = vi.spyOn(realService, 'acquire');

      const obs = await interceptor.intercept(context, next);
      await new Promise<void>((resolve) => obs.subscribe({ complete: () => resolve() }));

      expect(acquireSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 'user:user-777',
          ttlSeconds: 600,
          lockTtlMs: 20000,
          waitTimeoutMs: 3000,
          fallback: 'fail-open',
        }),
      );
    });

    it('场景 53: 支持从 req.session.user.id 解析用户身份，实现多鉴权形态兼容', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context, req } = createMockContext('POST', { 'idempotency-key': 'k-session' });
      req.session = { user: { id: 'session-user-999' } };
      const next = { handle: () => of('session-ok') };

      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const acquireSpy = vi.spyOn(realService, 'acquire');

      const obs = await interceptor.intercept(context, next);
      await new Promise<void>((resolve) => obs.subscribe({ complete: () => resolve() }));

      expect(acquireSpy).toHaveBeenCalledWith(expect.objectContaining({ actor: 'user:session-user-999' }));
    });

    it('场景 54: 当无用户态且 ip/url 缺失时，安全降级为 ip:127.0.0.1 及空路径防止空指针', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context, req } = createMockContext('POST', { 'idempotency-key': 'k-empty-fallback' });
      req.ip = undefined;
      req.url = undefined;
      const next = { handle: () => of('fallback-ok') };

      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const acquireSpy = vi.spyOn(realService, 'acquire');

      const obs = await interceptor.intercept(context, next);
      await new Promise<void>((resolve) => obs.subscribe({ complete: () => resolve() }));

      expect(acquireSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 'ip:127.0.0.1',
          requestPath: '',
        }),
      );
    });

    it('场景 55: fail-open 模式下 acquire 返回 bypass: true 时，拦截器直接调用 next.handle() 透传执行', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ fallback: 'fail-open' });
      const { context } = createMockContext('POST', { 'idempotency-key': 'k-bypass-test' });
      const next = { handle: () => of('bypassed-data') };

      // Simulate Redis down in fail-open mode
      mockRedisClient.get.mockRejectedValueOnce(new Error('Redis down'));

      const obs = await interceptor.intercept(context, next);
      let emitted: any;
      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (val) => {
            emitted = val;
          },
          complete: () => resolve(),
        });
      });

      expect(emitted).toBe('bypassed-data');
    });

    it('场景 56: fail-closed 模式下底层抛出 503 时，拦截器直接冒泡中断请求保障强一致性', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext('POST', { 'idempotency-key': 'k-closed-test' });
      const next = { handle: () => of('data') };

      // Simulate Redis down in default fail-closed mode
      mockRedisClient.get.mockRejectedValueOnce(new Error('Redis connection refused'));

      await expect(interceptor.intercept(context, next)).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('Replay Execution & Header Sanitization', () => {
    it('场景 57: 短路回放并命中缓存，回写原始状态码与脱敏后响应头，注入 x-idempotency-replayed 标头', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context, res } = createMockContext('POST', { 'idempotency-key': 'k-replay' });

      const payloadHash = realService.computePayloadHash({ total: 100 });
      const storedData: StoredIdempotencyData = {
        requestPath: '/v1/orders',
        payloadHash,
        statusCode: 201,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'auth=stolen; Path=/',
          Connection: 'keep-alive',
          'X-Server-Id': 'node-1',
        },
        body: { orderId: 'ord-replay-123' },
      };

      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(storedData));

      const next = { handle: vi.fn() };

      const obs = await interceptor.intercept(context, next);
      let emitted: any;
      obs.subscribe((val) => {
        emitted = val;
      });

      expect(emitted).toEqual({ orderId: 'ord-replay-123' });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.header).toHaveBeenCalledWith('x-idempotency-replayed', 'true');
      expect(res.header).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(res.header).toHaveBeenCalledWith('X-Server-Id', 'node-1');

      // Crucial security check: Set-Cookie and Connection must NEVER be replayed!
      expect(res.header).not.toHaveBeenCalledWith('Set-Cookie', expect.anything());
      expect(res.header).not.toHaveBeenCalledWith('Connection', expect.anything());

      expect(next.handle).not.toHaveBeenCalled();
    });
  });

  describe('Status Code Caching Policy (2xx & 4xx vs 5xx/409/429)', () => {
    it('场景 58: 200 与 201 业务成功响应持久化至 Redis 并释放互斥锁', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context, res } = createMockContext('POST', { 'idempotency-key': 'k-201' });
      res.statusCode = 201;

      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const completeSpy = vi.spyOn(realService, 'complete');
      const failSpy = vi.spyOn(realService, 'fail');

      const next = { handle: () => of({ created: true }) };

      const obs = await interceptor.intercept(context, next);
      await new Promise<void>((resolve) => obs.subscribe({ complete: () => resolve() }));

      expect(completeSpy).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 201 }));
      expect(failSpy).not.toHaveBeenCalled();
    });

    it('场景 59: 确定性 422 业务规则校验错误响应被幂等缓存，防止恶意重复提交相同错误表单', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context, res } = createMockContext('POST', { 'idempotency-key': 'k-422' });
      res.statusCode = 422;

      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const completeSpy = vi.spyOn(realService, 'complete');

      const next = { handle: () => of({ error: 'Validation failed' }) };

      const obs = await interceptor.intercept(context, next);
      await new Promise<void>((resolve) => obs.subscribe({ complete: () => resolve() }));

      expect(completeSpy).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
    });

    it('场景 60: 500 服务端故障响应严禁缓存，拦截器捕获后立即调用 fail() 释放互斥锁以便重试', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context, res } = createMockContext('POST', { 'idempotency-key': 'k-500' });
      res.statusCode = 500;

      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const completeSpy = vi.spyOn(realService, 'complete');
      const failSpy = vi.spyOn(realService, 'fail');

      const next = { handle: () => of({ error: 'Internal server error' }) };

      const obs = await interceptor.intercept(context, next);
      await new Promise<void>((resolve) => obs.subscribe({ complete: () => resolve() }));

      expect(completeSpy).not.toHaveBeenCalled();
      expect(failSpy).toHaveBeenCalled();
    });

    it('场景 61: 429 Too Many Requests 限流响应严禁缓存，拦截器立即调用 fail() 释放锁', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context, res } = createMockContext('POST', { 'idempotency-key': 'k-429' });
      res.statusCode = 429;

      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const completeSpy = vi.spyOn(realService, 'complete');
      const failSpy = vi.spyOn(realService, 'fail');

      const next = { handle: () => of({ error: 'Rate limit exceeded' }) };

      const obs = await interceptor.intercept(context, next);
      await new Promise<void>((resolve) => obs.subscribe({ complete: () => resolve() }));

      expect(completeSpy).not.toHaveBeenCalled();
      expect(failSpy).toHaveBeenCalled();
    });

    it('场景 62: 设置 cacheStatusCodes 白名单后，不在名单内的 200 响应不予缓存并主动释放锁', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ cacheStatusCodes: [201] });
      const { context, res } = createMockContext('POST', { 'idempotency-key': 'k-custom-status' });
      res.statusCode = 200; // Not in [201] whitelist!

      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const completeSpy = vi.spyOn(realService, 'complete');
      const failSpy = vi.spyOn(realService, 'fail');

      const next = { handle: () => of({ ok: true }) };

      const obs = await interceptor.intercept(context, next);
      await new Promise<void>((resolve) => obs.subscribe({ complete: () => resolve() }));

      expect(completeSpy).not.toHaveBeenCalled();
      expect(failSpy).toHaveBeenCalled();
    });

    it('场景 63: 当底层的 res.statusCode 缺失或为假值时，安全保底视为 200 状态码', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context, res } = createMockContext('POST', { 'idempotency-key': 'k-no-status' });
      res.statusCode = 0; // falsy status code triggers (res.statusCode || 200)

      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const completeSpy = vi.spyOn(realService, 'complete');
      const next = { handle: () => of({ ok: true }) };

      const obs = await interceptor.intercept(context, next);
      await new Promise<void>((resolve) => obs.subscribe({ complete: () => resolve() }));

      expect(completeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 200,
        }),
      );
    });
  });

  describe('Exception Propagation and Unlock Handling', () => {
    it('场景 64: 业务 Observable 管道抛出异常时，拦截器确保调用 fail() 归还锁并冒泡原始异常', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const { context } = createMockContext('POST', { 'idempotency-key': 'k-throw' });

      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);

      const failSpy = vi.spyOn(realService, 'fail');

      const businessError = new Error('Payment gateway timeout');
      const next = { handle: () => throwError(() => businessError) };

      const obs = await interceptor.intercept(context, next);

      await expect(
        new Promise((_, reject) => {
          obs.subscribe({ error: reject });
        }),
      ).rejects.toThrow('Payment gateway timeout');

      expect(failSpy).toHaveBeenCalled();
    });
  });

  describe('High Concurrency & Thundering Herd Simulation', () => {
    it('场景 65: 高并发同一 Key 击穿（羊群效应）压测 - 5 个并发请求，1 个执行，4 个自旋等待并回放缓存', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ waitTimeoutMs: 3000 });

      let cacheStore: string | null = null;
      let lockHolder: string | null = null;

      // Mock Redis state machine simulating atomic Redis cluster
      mockRedisClient.get.mockImplementation(async (key: string) => {
        if (key.includes(':cache:')) {
          return cacheStore;
        }
        return null;
      });

      mockRedisClient.set.mockImplementation(
        async (key: string, token: string, _px: string, _ttl: number, flag?: string) => {
          if (key.includes(':cache:')) {
            cacheStore = token; // serialized JSON
            return 'OK';
          }
          if (flag === 'NX') {
            if (!lockHolder) {
              lockHolder = token;
              return 'OK';
            }
            return null; // lock already held
          }
          return 'OK';
        },
      );

      mockRedisClient.eval.mockImplementation(
        async (_script: string, _keysCount: number, _key: string, token: string) => {
          if (lockHolder === token) {
            lockHolder = null;
            return 1;
          }
          return 0;
        },
      );

      let downstreamExecutionCount = 0;

      // Simulate 5 simultaneous requests with the exact same idempotency key and body
      const promises = Array.from({ length: 5 }).map(async (_, idx) => {
        const { context, resHeaders } = createMockContext(
          'POST',
          { 'idempotency-key': 'concurrent-key-thundering' },
          { id: 'user-shared' },
          '10.0.0.1',
          '/v1/transfers',
          { amount: 500, to: 'account-b' },
        );

        const next = {
          handle: () => {
            downstreamExecutionCount++;
            return of({ transferId: 'tx-999', idx });
          },
        };

        const obs = await interceptor.intercept(context, next);
        return new Promise<any>((resolve, reject) => {
          obs.subscribe({
            next: (val) => resolve({ val, resHeaders }),
            error: reject,
          });
        });
      });

      const results = await Promise.all(promises);

      // Downstream handler must have executed EXACTLY ONCE!
      expect(downstreamExecutionCount).toBe(1);

      // All 5 requests must have received identical business payload
      for (const res of results) {
        expect(res.val.transferId).toBe('tx-999');
      }

      // The 4 spin-waiting requests must have x-idempotency-replayed header
      const replayedCount = results.filter((r) => r.resHeaders['x-idempotency-replayed'] === 'true').length;
      expect(replayedCount).toBe(4);
    });
  });
});
