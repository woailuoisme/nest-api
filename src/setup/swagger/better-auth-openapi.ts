import type { PathItemObject, PathsObject, ReferenceObject, SchemaObject } from '@nestjs/swagger';
import { compact } from 'es-toolkit';
import { auth } from '@/common/auth/better-auth';

/** 中文 Tag 元数据定义 */
export interface TagMetadata {
  name: string;
  description: string;
}

/** Better Auth 原始 Tag 到规范中文 Tag 的映射表 */
export const BETTER_AUTH_TAG_MAP: Record<string, TagMetadata> = {
  Default: {
    name: '认证-核心凭据',
    description: '用户注册、密码/凭据登录、登出、会话查询与密码重置',
  },
  'Two-factor': {
    name: '认证-双因素(2FA)',
    description: 'TOTP 动态口令、备用恢复码与多因素安全验证',
  },
  Username: {
    name: '认证-用户名',
    description: '用户名注册登录、唯一性校验与改名操作',
  },
  'Phone-number': {
    name: '认证-手机号',
    description: '手机号短信验证码登录与绑定解绑',
  },
  'Magic-link': {
    name: '认证-魔术链接',
    description: '免密安全邮箱魔术链接生成与快速登录',
  },
  'Email-otp': {
    name: '认证-动态验证码',
    description: '邮箱一次性验证码 (OTP) 登录与安全校验',
  },
  'Api-key': {
    name: '认证-API密钥',
    description: '开发者 API Key 创建、权限管控与吊销',
  },
  Organization: {
    name: '认证-组织租户',
    description: '团队/组织创建、多租户成员邀请与角色管理',
  },
  'Multi-session': {
    name: '认证-会话管理',
    description: '多端登录设备查看、下线与全端会话登出',
  },
  Jwt: {
    name: '认证-JWT密钥',
    description: 'JWT 签名颁发与 JWKS 公钥轮换发现',
  },
  'Device-authorization': {
    name: '认证-三方与设备',
    description: 'RFC 8628 设备码授权流与物联网设备绑定',
  },
  Admin: {
    name: '认证-管理员治理',
    description: '管理员对用户的封禁、角色下发、冒充与会话吊销',
  },
};

/** 统一注入的 OpenAPI 双模态鉴权凭据定义 */
export const BETTER_AUTH_SECURITY_SCHEMES = {
  bearerAuth: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Bearer Token (JWT 或 API Key / Bearer 凭据)',
  },
  cookieAuth: {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description: 'Better Auth 会话 Cookie (better-auth.session_token)',
  },
} as const;

/** 处理后的 Better Auth OpenAPI 规格包 */
export interface ProcessedBetterAuthOpenAPI {
  clientPaths: PathsObject;
  adminPaths: PathsObject;
  allPaths: PathsObject;
  clientTags: TagMetadata[];
  adminTags: TagMetadata[];
  allTags: TagMetadata[];
  schemas: Record<string, SchemaObject | ReferenceObject>;
}

let cachedPromise: Promise<ProcessedBetterAuthOpenAPI> | null = null;

/** 清理缓存（供单测使用） */
export function clearBetterAuthOpenAPICache(): void {
  cachedPromise = null;
}

/**
 * 解析并加工 Better Auth OpenAPI Schema：
 * 1. 统一挂接 `/v1/auth` 绝对路径前缀，确保 Scalar UI Try It Out 真实可达；
 * 2. 将 14 个插件的英文 Tag 转换为优雅规范的中文分类；
 * 3. 注入 `bearerAuth` 与 `cookieAuth` 双模态凭据；
 * 4. 按前后台权限边界拆分客户端端点（93 个）与管理特权端点（15 个）。
 */
export async function getProcessedBetterAuthOpenAPI(): Promise<ProcessedBetterAuthOpenAPI> {
  if (cachedPromise) {
    return cachedPromise;
  }

  cachedPromise = (async () => {
    const rawSchema = (await auth.api.generateOpenAPISchema()) as unknown as {
      paths?: Record<string, Record<string, Record<string, unknown>>>;
      components?: { schemas?: Record<string, SchemaObject | ReferenceObject> };
    };

    const clientPaths: PathsObject = {};
    const adminPaths: PathsObject = {};
    const allPaths: PathsObject = {};

    const usedClientTags = new Set<string>();
    const usedAdminTags = new Set<string>();
    const usedAllTags = new Set<string>();

    const rawPaths = rawSchema.paths || {};

    for (const [subPath, methods] of Object.entries(rawPaths)) {
      const fullPath = `/v1/auth${subPath}`;
      const transformedMethods: Record<string, unknown> = {};

      let hasAdminTag = false;

      for (const [method, operation] of Object.entries(methods)) {
        const rawTags = (operation.tags as string[]) || ['Default'];
        const isCurrentOpAdmin = rawTags.includes('Admin');
        if (isCurrentOpAdmin) {
          hasAdminTag = true;
        }

        const mappedTags = rawTags.map((t) => BETTER_AUTH_TAG_MAP[t]?.name || t);

        for (const t of rawTags) {
          usedAllTags.add(t);
          if (isCurrentOpAdmin) {
            usedAdminTags.add(t);
          } else {
            usedClientTags.add(t);
          }
        }

        transformedMethods[method] = {
          ...operation,
          tags: mappedTags,
          security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        };
      }

      allPaths[fullPath] = transformedMethods as PathItemObject;
      if (hasAdminTag) {
        adminPaths[fullPath] = transformedMethods as PathItemObject;
      } else {
        clientPaths[fullPath] = transformedMethods as PathItemObject;
      }
    }

    const mapTags = (tagKeys: Set<string>): TagMetadata[] =>
      compact(Array.from(tagKeys).map((k) => BETTER_AUTH_TAG_MAP[k]));

    const clientTags = mapTags(usedClientTags);
    const adminTags = mapTags(usedAdminTags);
    const allTags = mapTags(usedAllTags);

    const schemas = rawSchema.components?.schemas || {};

    return {
      clientPaths,
      adminPaths,
      allPaths,
      clientTags,
      adminTags,
      allTags,
      schemas,
    };
  })();

  return cachedPromise;
}
