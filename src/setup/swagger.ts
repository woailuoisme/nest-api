import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { renderApiReference } from '@scalar/client-side-rendering';

import { APP_VERSION, OPENAPI_VERSION, PATHS, ROUTES } from '@/common/constants/app.constants';
import { ADMIN_FEATURE_MODULES, AuthModule, CLIENT_FEATURE_MODULES } from '@/features';

import { zodStandardSchemaConverter } from './swagger/standard-schema-converter';

function createCleanDocument(
  app: NestFastifyApplication,
  config: Omit<OpenAPIObject, 'paths'>,
  include: readonly Type<unknown>[],
): OpenAPIObject {
  const doc = SwaggerModule.createDocument(app, config, {
    include: [...include],
    standardSchemaConverter: zodStandardSchemaConverter,
  });
  return doc;
}

/** 三份文档共用的服务器条目（client / admin 由 DocumentBuilder 消费，auth 手写 spec 直接引用） */
const CURRENT_SERVER_DESCRIPTION = 'Current server';
const PRODUCTION_SERVER = { url: 'https://api.xxx.com', description: 'Production server' } as const;

/** 客户端与管理后台文档的公共配置（标题、描述、版本、服务器、双模态凭据），调用方再追加自身 tag */
function createBaseDocConfig(appUrl: string, title: string, description: string) {
  return new DocumentBuilder()
    .setTitle(title)
    .setDescription(description)
    .setVersion(APP_VERSION)
    .setOpenAPIVersion(OPENAPI_VERSION)
    .addServer(appUrl, CURRENT_SERVER_DESCRIPTION)
    .addServer(PRODUCTION_SERVER.url, PRODUCTION_SERVER.description)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearerAuth')
    .addCookieAuth('__Host-sid', undefined, 'cookieAuth');
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
> 认证与多因素鉴权端点已独立收敛至 [认证 API Reference](/${ROUTES.AUTH_DOCS})。
`.trim();
  const clientDescription = existsSync(apiMdPath)
    ? `${clientDocHeader}\n\n${readFileSync(apiMdPath, 'utf-8')}`
    : `${clientDocHeader}\n\nClient & Features RESTful API Specification`;

  const adminDescription = `
# 管理后台 API 设计规范与接入指南

> [!NOTE]
> 管理员登录与治理相关端点已独立收敛至 [认证 API Reference](/${ROUTES.AUTH_DOCS})。

本文档汇集管理后台自包含领域端点（C 端用户管理、系统监控指标、全局广播通知等）。
所有端点统一归入 \`/v1/admin\` 前缀，并由域级授权策略（\`AdminPolicy\`）实施准入保护。
  `.trim();

  const authDescription = `
# 认证 API 参考

本文档汇总 \`@nestjs/authentication\` 驱动的认证端点：注册、登录、JWT 签发/刷新/吊销、
两步验证（TOTP）、邮箱验证、找回密码与登录设备管理。
会话凭据为 \`__Host-sid\` Cookie，移动端使用 Bearer JWT。
  `.trim();

  // ─── 1. 客户端 API 文档 (Client API) ──────────────────────────────────
  const clientDocConfig = createBaseDocConfig(appUrl, 'Client API', clientDescription)
    .addTag('用户中心', '用户个人资料、头像上传与信息查询')
    .build();

  const clientDocument = createCleanDocument(
    app,
    clientDocConfig,
    CLIENT_FEATURE_MODULES.filter((module) => module !== AuthModule),
  );

  // ─── 2. 管理后台 API 文档 (Admin API) ──────────────────────────────────
  const adminDocConfig = createBaseDocConfig(appUrl, 'Admin API', adminDescription)
    .addTag('用户管理', 'C 端用户列表、角色调整与账号删除')
    .addTag('仪表盘', '系统运行时健康指标与监控大盘')
    .addTag('消息通知', '实时事件向指定用户或全局广播派发')
    .build();

  const adminDocument = createCleanDocument(app, adminDocConfig, ADMIN_FEATURE_MODULES);

  // ─── 3. 认证 API 文档 (Auth API) ───────────────────────────────────────
  const authDocConfig = createBaseDocConfig(appUrl, '认证 API', authDescription)
    .addTag('认证', '注册、登录、令牌、两步验证与登录设备管理')
    .build();

  const authDocument = createCleanDocument(app, authDocConfig, [AuthModule]);

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
  const renderScalarPage = (doc: OpenAPIObject, pageTitle: string) =>
    renderApiReference({ config: { ...SCALAR_UNIFIED_CONFIG, spec: { content: doc } }, pageTitle });

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

  // 三份文档结构一致：JSON 端点 + 预渲染 Scalar 页面成对注册
  const documents = [
    { jsonRoute: ROUTES.DOCS_JSON, htmlRoute: ROUTES.DOCS, document: clientDocument, title: 'Client API Reference' },
    {
      jsonRoute: ROUTES.ADMIN_DOCS_JSON,
      htmlRoute: ROUTES.ADMIN_DOCS,
      document: adminDocument,
      title: 'Admin API Reference',
    },
    {
      jsonRoute: ROUTES.AUTH_DOCS_JSON,
      htmlRoute: ROUTES.AUTH_DOCS,
      document: authDocument,
      title: '认证 API Reference',
    },
  ];

  for (const { jsonRoute, htmlRoute, document, title } of documents) {
    registerDocRoutePair(jsonRoute, document, htmlRoute, renderScalarPage(document, title));
  }

  return {
    clientDocsUrl: `${appUrl}/${ROUTES.DOCS}`,
    adminDocsUrl: `${appUrl}/${ROUTES.ADMIN_DOCS}`,
    authDocsUrl: `${appUrl}/${ROUTES.AUTH_DOCS}`,
  };
}
