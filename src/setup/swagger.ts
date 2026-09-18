import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { renderApiReference } from '@scalar/client-side-rendering';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { APP_VERSION, OPENAPI_VERSION, PATHS, ROUTES } from '@/common/constants/app.constants';
import { ADMIN_FEATURE_MODULES, CLIENT_FEATURE_MODULES } from '@/features';
import { BETTER_AUTH_SECURITY_SCHEMES, getProcessedBetterAuthOpenAPI } from './swagger/better-auth-openapi';

function createCleanDocument(
  app: NestFastifyApplication,
  config: Omit<OpenAPIObject, 'paths'>,
  include: readonly Type<unknown>[],
): OpenAPIObject {
  const rawDocument = SwaggerModule.createDocument(app, config, { include: [...include] });
  const doc = cleanupOpenApiDoc(rawDocument);
  delete doc.paths['/auth/{path}'];
  delete doc.paths['/v1/auth/{path}'];
  delete doc.paths['/v1/auth/*'];
  doc.components = {
    ...doc.components,
    securitySchemes: {
      ...doc.components?.securitySchemes,
      ...BETTER_AUTH_SECURITY_SCHEMES,
    },
  };
  return doc;
}

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

  const clientDocument = createCleanDocument(app, clientDocConfig, CLIENT_FEATURE_MODULES);

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

  const adminDocument = createCleanDocument(app, adminDocConfig, ADMIN_FEATURE_MODULES);

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

    // Introduction 区域通栏全宽排版（文档正文 100% 全宽展开，卡片沉降至底部自适应网格展示）
    customCss: `
      .introduction-section .section-columns {
        flex-direction: column !important;
        gap: 32px !important;
      }
      .introduction-section .section-column {
        max-width: 100% !important;
        width: 100% !important;
      }
      .introduction-section .sticky-cards {
        position: static !important;
        top: auto !important;
        max-width: 100% !important;
        width: 100% !important;
      }
      .introduction-section .introduction-card {
        display: grid !important;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)) !important;
        gap: 16px !important;
      }
      .introduction-section .introduction-card .scalar-reference-intro-clients {
        grid-column: 1 / -1 !important;
      }

      /* 隐藏侧边栏顶部 "Ask AI" 按钮，让搜索框独占整行 */
      div[class*="gap-1.5"][class*="px-3"] > button:not(:first-of-type),
      .flex.gap-1\\.5.px-3.pt-3 > button:not(:first-of-type) {
        display: none !important;
      }

      /* 隐藏侧边栏底部及全站 "Powered by Scalar" 署名链接，保留深色模式切换开关对齐 */
      a[href="https://www.scalar.com"],
      a[href="https://www.scalar.com/"],
      .scalar-version-number {
        display: none !important;
      }
    `,
  } as const;

  // ─── 5. 预渲染 Scalar HTML (零延迟、零前缀污染) ──────────────────────────
  const renderScalarPage = (doc: OpenAPIObject | typeof authDocument, pageTitle: string) =>
    renderApiReference({ config: { ...SCALAR_UNIFIED_CONFIG, spec: { content: doc } }, pageTitle });

  const clientScalarHtml = renderScalarPage(clientDocument, 'NestForge Client API Reference');
  const adminScalarHtml = renderScalarPage(adminDocument, 'NestForge Admin API Reference');
  const authScalarHtml = renderScalarPage(authDocument, 'NestForge Better Auth API Reference');

  const httpAdapter = app.getHttpAdapter();
  const fastifyInstance = httpAdapter.getInstance();

  const registerDocRoutePair = (jsonRoute: string, doc: unknown, htmlRoute: string, html: string) => {
    fastifyInstance.get(
      `/${jsonRoute}`,
      (_req: unknown, reply: { header?: (k: string, v: string) => void; send: (data: unknown) => void }) => {
        reply.header?.('Cache-Control', 'public, max-age=60');
        reply.send(doc);
      },
    );
    fastifyInstance.get(
      `/${htmlRoute}`,
      (_req: unknown, reply: { type?: (k: string) => void; send: (data: unknown) => void }) => {
        reply.type?.('text/html; charset=utf-8');
        reply.send(html);
      },
    );
  };

  registerDocRoutePair(ROUTES.DOCS_JSON, clientDocument, ROUTES.DOCS, clientScalarHtml);
  registerDocRoutePair(ROUTES.ADMIN_DOCS_JSON, adminDocument, ROUTES.ADMIN_DOCS, adminScalarHtml);
  registerDocRoutePair(ROUTES.AUTH_DOCS_JSON, authDocument, ROUTES.AUTH_DOCS, authScalarHtml);

  return {
    clientDocsUrl: `${appUrl}/${ROUTES.DOCS}`,
    adminDocsUrl: `${appUrl}/${ROUTES.ADMIN_DOCS}`,
    authDocsUrl: `${appUrl}/${ROUTES.AUTH_DOCS}`,
  };
}
