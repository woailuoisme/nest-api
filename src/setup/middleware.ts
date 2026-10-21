import {
  HttpStatus,
  Logger,
  StandardSchemaSerializerInterceptor,
  StandardSchemaValidationPipe,
  UnprocessableEntityException,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';

import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { IdempotencyInterceptor } from '@/common/idempotency';
import { TimeoutInterceptor } from '@/common/interceptors/timeout.interceptor';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';
import type { EnvConfig } from '@/config/env.validation';
import { PinoLoggerService } from '@/setup/logger/pino-logger.service';

/** 微信支付服务端回调路径后缀：CSRF 豁免兜底（详见 enableCsrfProtection 处说明） */
const WEPAY_NOTIFY_SUFFIX = '/payments/wepay/notify';

/** Standard Schema issue 的最小结构（结构化声明，避免直接依赖传递依赖 `@standard-schema/spec` 的类型） */
type ValidationIssue = {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[];
};

/** 将 Standard Schema 校验 issues 聚合为 `字段路径 -> 文案数组` 映射（无路径的归入 `root`） */
function groupIssuesByField(issues: readonly ValidationIssue[]): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of issues) {
    const path = (issue.path ?? [])
      .map((segment) => String(typeof segment === 'object' && segment !== null ? segment.key : segment))
      .join('.');
    const field = path || 'root';
    fields[field] ??= [];
    fields[field].push(issue.message);
  }
  return fields;
}

/**
 * 创建统一校验管道（Nest 12 原生 Standard Schema 通道）
 *
 * 复用 docs/api.md 已定义的错误契约：422 + `{ code, message, fields, errors }` 四键零变化。
 * 仅对声明了 `schema` 的参数装饰器（`@Body({ schema })` / `@Query({ schema })` / `@Param(name, { schema })`）生效。
 *
 * `validateCustomDecorators` 默认 false：`createParamDecorator` 创建的自定义参数即使声明了 `schema` 也会被跳过。
 * 本仓库已有 3 个自定义装饰器（@CurrentUser / @Session / @ReqSignal），当前均未带 schema，
 * 开启是为避免未来「@Foo({ schema }) 静默不校验」的隐蔽失效；对未声明 schema 的参数无任何影响。
 */
export function createApiValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    validateCustomDecorators: true,
    exceptionFactory: (issues) => {
      const fields = groupIssuesByField(issues);
      return new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        fields,
        errors: fields,
      });
    },
  });
}

/**
 * 归一化配置中的公开来源为浏览器 `Origin` 形式（`scheme://host[:port]`）
 *
 * CSRF 信任列表要求严格形态（无路径、无通配符、无凭证），个别笔误不应导致启动失败，
 * 故非法值跳过（宁缺勿滥：未被信任的来源只会被拒绝，不会放行），但逐条 warn —
 * 否则「非空却解析失败」的配置只会表现为前端 403，排查成本极高。
 */
function resolveTrustedOrigins(values: (string | undefined)[], logger = new Logger('TrustedOrigins')): string[] {
  const origins = new Set<string>();
  for (const value of values) {
    for (const candidate of (value ?? '').split(',')) {
      const raw = candidate.trim();
      if (!raw) continue;
      if (raw.includes('*')) {
        logger.warn(`来源含通配符，CSRF 信任列表不支持，已忽略: ${raw}`);
        continue;
      }
      try {
        const { origin, protocol } = new URL(raw);
        if (protocol === 'http:' || protocol === 'https:') {
          origins.add(origin);
        } else {
          logger.warn(`来源协议非 http/https，已忽略: ${raw}`);
        }
      } catch {
        logger.warn(`来源不是合法 URL，已忽略: ${raw}`);
      }
    }
  }
  return [...origins];
}

/** 配置全局中间件、版本控制、安全防护、验证管道、异常过滤器与拦截器 */
export function setupGlobalMiddleware(app: NestFastifyApplication): void {
  app.useLogger(app.get(PinoLoggerService));
  app.enableCors();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const config = app.get(ConfigService<EnvConfig, true>);

  // 框架内置跨站请求防护：基于 Fetch Metadata（Sec-Fetch-Site + Origin/Host 回退）而非令牌方案。
  // 无 `Origin` / `Sec-Fetch-Site` 的服务端调用天然放行；仅浏览器发出的跨站写请求会被拒绝。
  // 微信支付回调由服务端发起（无 Origin），此处豁免仅为反向代理注入 Origin 时的兜底，属资金链路保险。
  app.enableCsrfProtection({
    trustedOrigins: resolveTrustedOrigins([
      config.get('TRUSTED_ORIGINS'),
      config.get('APP_URL'),
      config.get('BETTER_AUTH_URL'),
    ]),
    exclude: (request: FastifyRequest) => (request.url.split('?')[0] ?? '').endsWith(WEPAY_NOTIFY_SUFFIX),
  });

  app.useGlobalPipes(createApiValidationPipe());

  app.useGlobalFilters(new HttpExceptionFilter(config.get('APP_DEBUG')));

  const reflector = app.get(Reflector);
  const idempotencyInterceptor = app.get(IdempotencyInterceptor);
  const httpTimeoutMs = config.get('HTTP_TIMEOUT_MS');
  app.useGlobalInterceptors(
    new TimeoutInterceptor(reflector, httpTimeoutMs),
    idempotencyInterceptor,
    // 响应序列化：读取 handler/class 上的 @SerializeOptions({ schema }) 做输出白名单裁剪（未声明 schema 的端点零开销透传）。
    // 位置须在 TransformInterceptor 之前：拦截器响应映射按注册顺序反向执行，此处可在信封归一化之后校验最终载荷。
    // 该顺序契约由 tests/unit/setup/response-serializer.test.ts 锁定，调整顺序前请先看那份用例。
    new StandardSchemaSerializerInterceptor(reflector),
    new TransformInterceptor(reflector),
  );
}
