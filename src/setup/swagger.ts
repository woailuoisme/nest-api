import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { renderApiReference } from '@scalar/client-side-rendering';
import { customThemeCSS } from '@scalar/nestjs-api-reference';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { ADMIN_API_MODULES, CLIENT_API_MODULES } from '@/api';
import { APP_VERSION, OPENAPI_VERSION, PATHS, ROUTES } from '@/common/constants/app.constants';

export interface ApiDocUrls {
  clientDocsUrl: string;
  adminDocsUrl: string;
}

/** 配置 API 文档 (OpenAPI Spec + Scalar UI — 客户端与管理后台双文档隔离) */
export function setupApiDocumentation(app: NestFastifyApplication, appUrl: string): ApiDocUrls {
  const apiMdPath = join(process.cwd(), PATHS.API_MD_FILE);
  const clientDescription = existsSync(apiMdPath)
    ? readFileSync(apiMdPath, 'utf-8')
    : 'NestForge Client & Features RESTful API Specification';

  const adminDescription = `
# NestForge 管理后台 API 设计规范与接入指南

本文档汇集管理后台自包含领域端点（认证、管理员治理、C 端用户管理、系统监控指标、全局广播通知等）。
所有端点统一归入 \`/v1/admin\` 前缀并由全局 \`AdminPrefixGuard\` 与 \`AdminRole\` 实施准入保护。
  `.trim();

  // ─── 1. 客户端 API 文档 (Client API) ──────────────────────────────────
  const clientDocConfig = new DocumentBuilder()
    .setTitle('NestForge Client API')
    .setDescription(clientDescription)
    .setVersion(APP_VERSION)
    .setOpenAPIVersion(OPENAPI_VERSION)
    .addServer(appUrl, 'Current server')
    .addServer('https://api.xxx.com', 'Production server')
    .addBearerAuth()
    .addTag('认证', '用户注册、登录、Token 刷新与三方 OAuth')
    .addTag('用户中心', '用户个人资料、头像上传与信息查询')
    .build();

  const rawClientDocument = SwaggerModule.createDocument(app, clientDocConfig, {
    include: [...CLIENT_API_MODULES],
  });
  const clientDocument = cleanupOpenApiDoc(rawClientDocument);

  // ─── 2. 管理后台 API 文档 (Admin API) ──────────────────────────────────
  const adminDocConfig = new DocumentBuilder()
    .setTitle('NestForge Admin API')
    .setDescription(adminDescription)
    .setVersion(APP_VERSION)
    .setOpenAPIVersion(OPENAPI_VERSION)
    .addServer(appUrl, 'Current server')
    .addServer('https://api.xxx.com', 'Production server')
    .addBearerAuth()
    .addTag('认证管理', '管理员登录、凭据轮换与个人信息')
    .addTag('管理员管理', '平台管理员账号 CRUD 与状态治理')
    .addTag('用户管理', 'C 端用户列表、角色调整与账号删除')
    .addTag('仪表盘', '系统运行时健康指标与监控大盘')
    .addTag('消息通知', '实时事件向指定用户或全局广播派发')
    .build();

  const rawAdminDocument = SwaggerModule.createDocument(app, adminDocConfig, {
    include: [...ADMIN_API_MODULES],
  });
  const adminDocument = cleanupOpenApiDoc(rawAdminDocument);

  // ─── 3. 预渲染 Scalar HTML (零延迟、零前缀污染) ──────────────────────────
  const clientScalarHtml = renderApiReference(
    {
      config: {
        spec: { content: clientDocument },
        theme: 'purple',
        hideModels: true,
        _integration: 'nestjs',
      },
      pageTitle: 'NestForge Client API Reference',
    },
    customThemeCSS,
  );

  const adminScalarHtml = renderApiReference(
    {
      config: {
        spec: { content: adminDocument },
        theme: 'deepSpace',
        hideModels: true,
        _integration: 'nestjs',
      },
      pageTitle: 'NestForge Admin API Reference',
    },
    customThemeCSS,
  );

  const httpAdapter = app.getHttpAdapter();
  const fastifyInstance = httpAdapter.getInstance();

  // OpenAPI JSON Spec 数据源 (设置 60 秒客户端缓存加速文档加载)
  fastifyInstance.get(
    `/${ROUTES.DOCS_JSON}`,
    (_req: unknown, reply: { header?: (k: string, v: string) => void; send: (data: unknown) => void }) => {
      reply.header?.('Cache-Control', 'public, max-age=60');
      reply.send(clientDocument);
    },
  );

  fastifyInstance.get(
    `/${ROUTES.ADMIN_DOCS_JSON}`,
    (_req: unknown, reply: { header?: (k: string, v: string) => void; send: (data: unknown) => void }) => {
      reply.header?.('Cache-Control', 'public, max-age=60');
      reply.send(adminDocument);
    },
  );

  // Scalar API Reference UI (使用 Fastify 原生路由精确匹配，杜绝 prefix 拦截冲突)
  fastifyInstance.get(
    `/${ROUTES.DOCS}`,
    (_req: unknown, reply: { type?: (k: string) => void; send: (data: unknown) => void }) => {
      reply.type?.('text/html; charset=utf-8');
      reply.send(clientScalarHtml);
    },
  );

  fastifyInstance.get(
    `/${ROUTES.ADMIN_DOCS}`,
    (_req: unknown, reply: { type?: (k: string) => void; send: (data: unknown) => void }) => {
      reply.type?.('text/html; charset=utf-8');
      reply.send(adminScalarHtml);
    },
  );

  return {
    clientDocsUrl: `${appUrl}/${ROUTES.DOCS}`,
    adminDocsUrl: `${appUrl}/${ROUTES.ADMIN_DOCS}`,
  };
}
