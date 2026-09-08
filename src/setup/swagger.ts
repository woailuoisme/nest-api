import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { renderApiReference } from '@scalar/client-side-rendering';
import { customThemeCSS } from '@scalar/nestjs-api-reference';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { ADMIN_API_MODULES, CLIENT_API_MODULES } from '@/api';
import { APP_VERSION, OPENAPI_VERSION, PATHS, ROUTES } from '@/common/constants/app.constants';
import { BETTER_AUTH_SECURITY_SCHEMES, getProcessedBetterAuthOpenAPI } from './swagger/better-auth-openapi';

export interface ApiDocUrls {
  clientDocsUrl: string;
  adminDocsUrl: string;
  authDocsUrl: string;
}

/** 配置 API 文档 (OpenAPI Spec + Scalar UI — 客户端、管理后台与认证专有三文档独立隔离) */
export async function setupApiDocumentation(app: NestFastifyApplication, appUrl: string): Promise<ApiDocUrls> {
  const apiMdPath = join(process.cwd(), PATHS.API_MD_FILE);
  const clientDocHeader = `
> [!NOTE]
> 认证与多因素鉴权端点已独立收敛至 [Better Auth API Reference](/${ROUTES.AUTH_DOCS})。
`.trim();
  const clientDescription = existsSync(apiMdPath)
    ? `${clientDocHeader}\n\n${readFileSync(apiMdPath, 'utf-8')}`
    : `${clientDocHeader}\n\nNestForge Client & Features RESTful API Specification`;

  const adminDescription = `
# NestForge 管理后台 API 设计规范与接入指南

> [!NOTE]
> 管理员登录与治理相关端点已独立收敛至 [Better Auth API Reference](/${ROUTES.AUTH_DOCS})。

本文档汇集管理后台自包含领域端点（C 端用户管理、系统监控指标、全局广播通知等）。
所有端点统一归入 \`/v1/admin\` 前缀并由全局 \`AdminPrefixGuard\` 与 \`AdminRole\` 实施准入保护。
  `.trim();

  const authDescription = `
# NestForge Better Auth 认证体系 API 参考

本文档汇总全量 14 个已启用插件的认证与权限管控端点（核心凭据、双因素 2FA、动态验证码、魔术链接、手机号、组织租户、API Key、多会话、管理员治理等）。
所有端点基于 \`/v1/auth\` 路径直接挂载，支持 \`Bearer Token\` 与 \`Cookie\` 复合双模态在线调试。
  `.trim();

  const betterAuthOpenAPI = await getProcessedBetterAuthOpenAPI();

  // ─── 1. 客户端 API 文档 (Client API) ──────────────────────────────────
  const clientDocConfig = new DocumentBuilder()
    .setTitle('NestForge Client API')
    .setDescription(clientDescription)
    .setVersion(APP_VERSION)
    .setOpenAPIVersion(OPENAPI_VERSION)
    .addServer(appUrl, 'Current server')
    .addServer('https://api.xxx.com', 'Production server')
    .addBearerAuth()
    .addCookieAuth('better-auth.session_token')
    .addTag('用户中心', '用户个人资料、头像上传与信息查询')
    .build();

  const rawClientDocument = SwaggerModule.createDocument(app, clientDocConfig, {
    include: [...CLIENT_API_MODULES],
  });
  const clientDocument = cleanupOpenApiDoc(rawClientDocument);

  // 清理任何遗留的通配认证路由
  delete clientDocument.paths['/auth/{path}'];
  delete clientDocument.paths['/v1/auth/{path}'];
  delete clientDocument.paths['/v1/auth/*'];
  clientDocument.components = {
    ...clientDocument.components,
    securitySchemes: {
      ...clientDocument.components?.securitySchemes,
      ...BETTER_AUTH_SECURITY_SCHEMES,
    },
  };

  // ─── 2. 管理后台 API 文档 (Admin API) ──────────────────────────────────
  const adminDocConfig = new DocumentBuilder()
    .setTitle('NestForge Admin API')
    .setDescription(adminDescription)
    .setVersion(APP_VERSION)
    .setOpenAPIVersion(OPENAPI_VERSION)
    .addServer(appUrl, 'Current server')
    .addServer('https://api.xxx.com', 'Production server')
    .addBearerAuth()
    .addCookieAuth('better-auth.session_token')
    .addTag('用户管理', 'C 端用户列表、角色调整与账号删除')
    .addTag('仪表盘', '系统运行时健康指标与监控大盘')
    .addTag('消息通知', '实时事件向指定用户或全局广播派发')
    .build();

  const rawAdminDocument = SwaggerModule.createDocument(app, adminDocConfig, {
    include: [...ADMIN_API_MODULES],
  });
  const adminDocument = cleanupOpenApiDoc(rawAdminDocument);

  // 清理任何遗留的通配认证路由
  delete adminDocument.paths['/auth/{path}'];
  delete adminDocument.paths['/v1/auth/{path}'];
  delete adminDocument.paths['/v1/auth/*'];
  adminDocument.components = {
    ...adminDocument.components,
    securitySchemes: {
      ...adminDocument.components?.securitySchemes,
      ...BETTER_AUTH_SECURITY_SCHEMES,
    },
  };

  // ─── 3. Better Auth 全量认证 API 文档 (Auth API) ───────────────────────
  const authDocument = {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'NestForge Better Auth API Reference',
      description: authDescription,
      version: APP_VERSION,
    },
    servers: [
      { url: appUrl, description: 'Current server' },
      { url: 'https://api.xxx.com', description: 'Production server' },
    ],
    tags: betterAuthOpenAPI.allTags,
    paths: betterAuthOpenAPI.allPaths,
    components: {
      schemas: betterAuthOpenAPI.schemas,
      securitySchemes: BETTER_AUTH_SECURITY_SCHEMES,
    },
  };

  /**
   * ─── 4. Scalar 统一企业级交互配置 ───────────────────────────────────────
   * 统一适用于 /docs (客户端)、/docs/admin (管理后台) 与 /docs/auth (认证专本)
   */
  const SCALAR_UNIFIED_CONFIG = {
    layout: 'modern',
    theme: 'purple',
    withDefaultFonts: true,
    hideDarkModeToggle: false,
    hideModels: true,

    // 接口标题与字段排版
    operationTitleSource: 'summary',
    showOperationId: false,
    defaultOpenFirstTag: true,
    defaultOpenAllTags: false,
    orderRequiredPropertiesFirst: true,
    orderSchemaPropertiesBy: 'preserve',
    expandAllModelSections: false,
    expandAllResponses: false,
    expandAllSchemaProperties: false,

    // 联调与开发体验
    persistAuth: true,
    hideTestRequestButton: false,
    hideClientButton: false,
    hideSearch: false,
    showDeveloperTools: 'localhost',
    showToolbar: 'localhost',
    documentDownloadType: 'both',

    // 隐私合规与自托管安全
    telemetry: false,
    isEditable: false,
    _integration: 'nestjs',
  } as const;

  // ─── 5. 预渲染 Scalar HTML (零延迟、零前缀污染) ──────────────────────────
  const clientScalarHtml = renderApiReference(
    {
      config: {
        ...SCALAR_UNIFIED_CONFIG,
        spec: { content: clientDocument },
      },
      pageTitle: 'NestForge Client API Reference',
    },
    customThemeCSS,
  );

  const adminScalarHtml = renderApiReference(
    {
      config: {
        ...SCALAR_UNIFIED_CONFIG,
        spec: { content: adminDocument },
      },
      pageTitle: 'NestForge Admin API Reference',
    },
    customThemeCSS,
  );

  const authScalarHtml = renderApiReference(
    {
      config: {
        ...SCALAR_UNIFIED_CONFIG,
        spec: { content: authDocument },
      },
      pageTitle: 'NestForge Better Auth API Reference',
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

  fastifyInstance.get(
    `/${ROUTES.AUTH_DOCS_JSON}`,
    (_req: unknown, reply: { header?: (k: string, v: string) => void; send: (data: unknown) => void }) => {
      reply.header?.('Cache-Control', 'public, max-age=60');
      reply.send(authDocument);
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

  fastifyInstance.get(
    `/${ROUTES.AUTH_DOCS}`,
    (_req: unknown, reply: { type?: (k: string) => void; send: (data: unknown) => void }) => {
      reply.type?.('text/html; charset=utf-8');
      reply.send(authScalarHtml);
    },
  );

  return {
    clientDocsUrl: `${appUrl}/${ROUTES.DOCS}`,
    adminDocsUrl: `${appUrl}/${ROUTES.ADMIN_DOCS}`,
    authDocsUrl: `${appUrl}/${ROUTES.AUTH_DOCS}`,
  };
}
