import { adminRbacPlugin } from '../rbac.config';
import { i18nPlugins } from './i18n.plugin';
import { infraPlugins } from './infra.plugin';
import { oauthPlugins } from './oauth.plugin';
import { organizationPlugin } from './organization.plugin';
import { securityPlugins } from './security.plugin';
import { socialAuthPlugins } from './social-auth.plugin';
import { ssoPlugins } from './sso.plugin';

export * from './i18n.plugin';
export * from './infra.plugin';
export * from './oauth.plugin';
export * from './organization.plugin';
export * from './security.plugin';
export * from './social-auth.plugin';
export * from './sso.plugin';

/**
 * 组装并返回所有已注册的 Better Auth 插件
 */
export function getAuthPlugins() {
  return [
    adminRbacPlugin,
    ...securityPlugins,
    organizationPlugin,
    ...oauthPlugins,
    ...socialAuthPlugins,
    ...infraPlugins,
    ...ssoPlugins,
    ...i18nPlugins,
  ];
}
