import { adminRbacPlugin } from '../rbac.config';
import { infraPlugins } from './infra.plugin';
import { securityPlugins } from './security.plugin';
import { socialAuthPlugins } from './social-auth.plugin';

export * from './infra.plugin';
export * from './security.plugin';
export * from './social-auth.plugin';

/**
 * 组装并返回所有已注册的 Better Auth 插件
 *
 * 面向 JWT + REST API 后端：不做浏览器端 ceremony（passkey/magicLink）、
 * 不做多租户（organization）、不做认证层文案本地化（better-auth i18n）——
 * 错误码语义交给客户端，应用层多语言由 nestjs-i18n 承担。
 */
export function getAuthPlugins() {
  return [adminRbacPlugin, ...securityPlugins, ...socialAuthPlugins, ...infraPlugins];
}
