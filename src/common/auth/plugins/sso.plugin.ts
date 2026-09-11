import { sso } from '@better-auth/sso';

/**
 * 企业级 SSO 插件集：支持 SAML 2.0 与 Enterprise OIDC 单点登录
 */
export const ssoPlugins = [
  sso({
    // 基础 SSO 配置，具体企业 IdP 可在管理面或数据库中动态注册
  }),
];
