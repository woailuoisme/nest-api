import { mkdir } from 'node:fs/promises';
import { join, posix } from 'node:path';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { auth } from '@/common/auth/better-auth';
import { PATHS, ROUTES } from '@/common/constants/app.constants';
import { RequestContext } from '@/common/context';
import { extractIp, PinoLoggerService } from '@/setup/logger';
import { isAppShuttingDown } from './lifecycle';
import { LOG_VIEWER_PATH } from './log-viewer/constants';

/** 仅暴露所需 Hook 与路由 API 的最小 Fastify 接口（规避 platform-fastify 嵌套 fastify 类型差异） */
type FastifyLike = {
  addHook(
    event: 'onRequest',
    hook:
      | ((request: FastifyRequest, reply: FastifyReply) => Promise<void> | void)
      | ((request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => void),
  ): void;
  addHook(event: 'onResponse', hook: (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void): void;
  addHook(
    event: 'onSend',
    hook: (request: FastifyRequest, reply: FastifyReply, payload: unknown) => Promise<unknown> | unknown,
  ): void;
  get: (url: string, handler: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>) => void;
};

/** /uploads/ 下无需鉴权的公开子目录（如产品图、公开头像） */
const PUBLIC_UPLOAD_PREFIX = '/uploads/public/';

/**
 * 不写入访问日志的路径前缀：API 文档、队列看板与日志查看器的高频轮询与 SSE 心跳属自检流量，
 * 逐条记录只会淹没业务请求日志。`/docs` 同时覆盖 docs-json、docs/admin 与 docs/auth。
 */
const ACCESS_LOG_EXCLUDED_PREFIXES = [`/${ROUTES.DOCS}`, `/${ROUTES.QUEUES}`, LOG_VIEWER_PATH];

/** 请求路径是否命中运维面板（含 /docs-json 等以短横线派生的 JSON 端点） */
function isOpsPanelPath(url: string): boolean {
  return ACCESS_LOG_EXCLUDED_PREFIXES.some(
    (prefix) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}-`),
  );
}

/**
 * 注册 Fastify 插件（Helmet, Static 文件服务, Multipart 文件上传）与原生全链路可观测性 Hooks。
 *
 * 1. 原生 Hooks 早于所有 Guard 与 Interceptor 执行，100% 捕获包括 401/403/404/429/500 在内的所有流量；
 * 2. 自动透传并回写 x-request-id 响应头，并初始化全链路 RequestContext (AsyncLocalStorage)；
 * 3. 私有上传文件需 JWT 鉴权（Authorization header 或 ?token= query），/uploads/public/ 子目录保持公开。
 */
export async function registerFastifyPlugins(app: NestFastifyApplication): Promise<void> {
  type RegisterPlugin = Parameters<typeof app.register>[0];
  const config = app.get(ConfigService);
  const loggerService = app.get(PinoLoggerService);
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyLike;

  // 1. 全链路 Request ID 与 AsyncLocalStorage 请求上下文 Hook
  fastify.addHook('onRequest', (request, reply, done) => {
    const id = request.id;
    const reqId = typeof id === 'string' && id ? id : (request.headers['x-request-id'] as string) || '';
    if (reqId) {
      request.headers['x-request-id'] = reqId;
      reply.header('x-request-id', reqId);
    }
    const nextFn = typeof done === 'function' ? done : () => {};
    RequestContext.run(
      {
        requestId: reqId,
        startTime: Date.now(),
      },
      nextFn,
    );
  });

  // 2. 全链路 HTTP 访问日志 Hook（Fastify 原生 onResponse，100% 覆盖包括 401/403/404/429/500 在内的所有流量）
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url?.split('?')[0] || '/';

    // 运维面板（/docs、/queues、/logs）的自检流量不计入访问日志；4xx/5xx 仍保留，便于发现鉴权失败与面板异常
    if (isOpsPanelPath(url) && reply.statusCode < 400) {
      return;
    }

    loggerService.logHttp({
      method: request.method,
      url,
      statusCode: reply.statusCode,
      duration: Number(reply.elapsedTime.toFixed(1)),
      ip: extractIp(request.raw),
    });
  });

  // 3. 优雅停机长连接协商 Hook（停机期间向在途响应注入 Connection: close，通知客户端不再复用 Socket）
  fastify.addHook('onSend', async (_request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (isAppShuttingDown()) {
      reply.header('connection', 'close');
    }
    return payload;
  });

  // 4. 原生 204 No Content 拦截 /favicon.ico，彻底消除 404 告警与磁盘 I/O，24 小时浏览器缓存
  fastify.get('/favicon.ico', (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, immutable');
    reply.code(204).send();
  });

  // 确保上传目录存在，避免 fastifyStatic 因 root 缺失而启动失败
  await mkdir(join(process.cwd(), PATHS.STORAGE_UPLOADS), { recursive: true });

  await app.register(fastifyHelmet as unknown as RegisterPlugin, { contentSecurityPolicy: false });
  await app.register(fastifyStatic as unknown as RegisterPlugin, {
    root: join(process.cwd(), PATHS.STORAGE_UPLOADS),
    prefix: '/uploads/',
  });

  // 私有上传文件鉴权：公开子目录放行，其余需合法 Better Auth 会话凭证
  const sendUnauthorized = (reply: FastifyReply) =>
    reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      },
    });

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawPath = request.url.split('?')[0];
    let normalizedPath: string;
    try {
      normalizedPath = posix.normalize(decodeURIComponent(rawPath));
    } catch {
      // 畸形百分号编码（如 /uploads/%）：路由器解码同样会失败并以 400 拒绝，此处直接放行避免 500 透出
      return;
    }

    if (!normalizedPath.startsWith('/uploads/') || normalizedPath.startsWith(PUBLIC_UPLOAD_PREFIX)) {
      return;
    }

    const headers = fromNodeHeaders(request.headers);
    const query = request.query as { token?: string } | undefined;
    if (query?.token && !headers.has('authorization')) {
      headers.set('authorization', `Bearer ${query.token.trim()}`);
    }

    try {
      const sessionData = await auth.api.getSession({ headers });
      const user = sessionData?.user as { banned?: boolean | null } | undefined;
      if (!user || user.banned) {
        await sendUnauthorized(reply);
        return;
      }
    } catch {
      await sendUnauthorized(reply);
      return;
    }
  });

  // 全局上传限制（硬性兜底）：文件大小可配，field 数量/单个 field 大小/总 parts 数防内存与 CPU 耗尽
  await app.register(fastifyMultipart as unknown as RegisterPlugin, {
    limits: {
      fileSize: config.get<number>('UPLOAD_MAX_FILE_SIZE_BYTES'),
      fields: 20,
      fieldSize: 1024 * 1024,
      parts: 30,
    },
  });
}
