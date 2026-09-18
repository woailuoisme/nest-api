import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isProductionEnv, PATHS } from '@/common/constants/app.constants';
import { matchesBasicAuth } from '@/common/utils/basic-auth.util';
import { type FastifyLike, LOG_VIEWER_PATH, type LogStreamQuery } from './constants';
import { clearLogFile, deleteLogFile, getSafeLogFilePath, listLogFiles, readLogEntries, watchLogTail } from './reader';
import { renderLogViewerHtml } from './template';

export * from './constants';
export * from './reader';
export * from './template';

/**
 * 统一处理 Log Viewer 内部异常并转换为标准 HTTP 响应
 */
function handleLogViewerError(error: unknown, reply: FastifyReply): FastifyReply {
  const message = error instanceof Error ? error.message : String(error);
  const isNotFound = message.toLowerCase().includes('not found');
  const isSecurityViolation = message.toLowerCase().includes('traversal') || message.toLowerCase().includes('invalid');
  const statusCode = isNotFound ? 404 : isSecurityViolation ? 400 : 500;

  return reply.code(statusCode).send({
    error: {
      message,
      statusCode,
    },
  });
}

/**
 * 挂载 Web Log Viewer（对齐 Laravel opcodesio/log-viewer 风格）
 * @param app NestFastifyApplication 实例
 * @param appUrl 应用基础访问 URL (如 http://localhost:4300)
 * @returns Log Viewer 访问完整 URL，若未挂载则返回空字符串
 */
export async function setupLogViewer(
  app: NestFastifyApplication,
  appUrl?: string,
  options?: { logViewerUser?: string; logViewerPassword?: string },
): Promise<string> {
  const { logViewerUser, logViewerPassword } = options ?? {};

  // 生产环境未配置访问凭据时拒绝挂载，防止系统日志与异常堆栈泄漏
  if (isProductionEnv() && (!logViewerUser || !logViewerPassword)) {
    return '';
  }

  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyLike;
  const logsDir = resolve(process.cwd(), PATHS.STORAGE_LOGS);

  // 确保日志目录存在
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  // Basic Auth 守卫（配置了凭据时生效）
  const isAuth = (request: FastifyRequest): boolean => {
    if (!logViewerUser || !logViewerPassword) return true;
    return matchesBasicAuth(request.headers.authorization, logViewerUser, logViewerPassword);
  };

  const sendLogAuth = (reply: FastifyReply): FastifyReply =>
    reply
      .code(401)
      .header('WWW-Authenticate', 'Basic realm="log-viewer"')
      .send({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });

  const withAuth =
    (handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!isAuth(req)) return sendLogAuth(reply);
      return handler(req, reply);
    };

  /** 生产环境禁用破坏性日志操作（清空 / 删除），统一 403 响应 */
  const rejectDestructiveOp = (reply: FastifyReply): FastifyReply =>
    reply
      .code(403)
      .send({ error: { code: 'FORBIDDEN', message: 'Destructive log operations are disabled in production' } });

  /**
   * 解析并校验待操作日志文件路径：路径越界由 getSafeLogFilePath 抛错（调用方转为 400），
   * 文件不存在时写出 404 并返回 null。必须在 try 块内调用。
   */
  const resolveExistingLogFile = (rawName: string, reply: FastifyReply): string | null => {
    const filePath = getSafeLogFilePath(rawName);
    if (!existsSync(filePath)) {
      void reply.code(404).send({ error: { message: 'File not found', statusCode: 404 } });
      return null;
    }
    return filePath;
  };

  // 1. Web UI 主入口页面
  fastify.get(
    LOG_VIEWER_PATH,
    withAuth(async (_req, reply) => {
      return reply.type('text/html; charset=utf-8').send(renderLogViewerHtml());
    }),
  );

  // 2. API: 获取所有日志文件列表
  fastify.get(
    `${LOG_VIEWER_PATH}/api/files`,
    withAuth(async (_req, reply) => {
      try {
        const files = await listLogFiles(logsDir);
        return reply.send({ files });
      } catch (error) {
        return handleLogViewerError(error, reply);
      }
    }),
  );

  // 3. API: 解析与检索指定文件的日志行 (支持倒序分块早退与增量缓存)
  fastify.get(
    `${LOG_VIEWER_PATH}/api/entries`,
    withAuth(async (req, reply) => {
      try {
        const result = await readLogEntries(logsDir, req.query as Record<string, string>);
        return reply.send(result);
      } catch (error) {
        return handleLogViewerError(error, reply);
      }
    }),
  );

  // 4. API: 响应式实时日志流 (Server-Sent Events)
  fastify.get(
    `${LOG_VIEWER_PATH}/api/stream`,
    withAuth(async (req, reply) => {
      const query = req.query as LogStreamQuery;
      const abortController = new AbortController();

      reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.flushHeaders?.();

      // 发送初始连接成功事件
      reply.raw.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', timestamp: Date.now() })}\n\n`);

      // 客户端断开连接时自动终止内部生成器
      req.raw.on('close', () => {
        abortController.abort();
      });

      try {
        const tailGenerator = watchLogTail(logsDir, query, { signal: abortController.signal });
        for await (const event of tailGenerator) {
          if (abortController.signal.aborted) break;

          if (event.type === 'entry') {
            reply.raw.write(`event: log\ndata: ${JSON.stringify(event.entry)}\n\n`);
          } else if (event.type === 'heartbeat') {
            reply.raw.write(`event: ping\ndata: ${JSON.stringify({ timestamp: event.timestamp })}\n\n`);
          } else if (event.type === 'error') {
            reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: event.message })}\n\n`);
          }
        }
      } catch {
        // 客户端断开或流结束
      } finally {
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      }
    }),
  );

  // 5. API: 下载原始日志文件
  fastify.get(
    `${LOG_VIEWER_PATH}/api/download`,
    withAuth(async (req, reply) => {
      const query = req.query as { file?: string };
      if (!query.file) {
        return reply.code(400).send({ error: { message: 'File parameter is required', statusCode: 400 } });
      }

      try {
        const filePath = resolveExistingLogFile(query.file, reply);
        if (!filePath) return reply;

        const stream = createReadStream(filePath);
        return reply
          .header('Content-Disposition', `attachment; filename="${basename(filePath)}"`)
          .header('Content-Type', 'text/plain; charset=utf-8')
          .send(stream);
      } catch (error) {
        return handleLogViewerError(error, reply);
      }
    }),
  );

  // 6. API: 清空日志文件内容 (生产环境禁用破坏性操作)
  fastify.post(
    `${LOG_VIEWER_PATH}/api/clear`,
    withAuth(async (req, reply) => {
      if (isProductionEnv()) return rejectDestructiveOp(reply);

      const query = req.query as { file?: string };
      if (!query.file) {
        return reply.code(400).send({ error: { message: 'File parameter is required', statusCode: 400 } });
      }

      try {
        const filePath = resolveExistingLogFile(query.file, reply);
        if (!filePath) return reply;

        await clearLogFile(filePath);
        return reply.send({ success: true, message: `Log file ${basename(filePath)} cleared` });
      } catch (error) {
        return handleLogViewerError(error, reply);
      }
    }),
  );

  // 7. API: 删除单个日志文件 (生产环境禁用破坏性操作)
  fastify.delete(
    `${LOG_VIEWER_PATH}/api/files/:filename`,
    withAuth(async (req, reply) => {
      if (isProductionEnv()) return rejectDestructiveOp(reply);

      const params = req.params as { filename?: string };
      if (!params.filename) {
        return reply.code(400).send({ error: { message: 'Filename parameter is required', statusCode: 400 } });
      }

      try {
        const filePath = resolveExistingLogFile(params.filename, reply);
        if (!filePath) return reply;

        await deleteLogFile(filePath);
        return reply.send({ success: true, message: `Log file ${basename(filePath)} deleted` });
      } catch (error) {
        return handleLogViewerError(error, reply);
      }
    }),
  );

  return appUrl ? `${appUrl}${LOG_VIEWER_PATH}` : LOG_VIEWER_PATH;
}
