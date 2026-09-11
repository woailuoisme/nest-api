import { deviceAuthorization, jwt, multiSession, openAPI, testUtils } from 'better-auth/plugins';

/**
 * 基础设施与协议适配插件集：JWT、设备代码流授权、多会话并发与 OpenAPI 规范生成
 * testUtils: 仅在非生产环境（开发/测试）挂载，供单元与 E2E 测试辅助校验
 */
export const infraPlugins = [
  jwt(),
  deviceAuthorization(),
  multiSession(),
  openAPI(),
  ...(process.env.NODE_ENV !== 'production' ? [testUtils()] : []),
];
