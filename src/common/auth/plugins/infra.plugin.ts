import { jwt, openAPI, testUtils } from 'better-auth/plugins';

import { isProductionEnv } from '@/common/constants/app.constants';

/**
 * 基础设施与协议适配插件集：JWT 与 OpenAPI 规范生成
 * testUtils: 仅在非生产环境（开发/测试）挂载，供单元与 E2E 测试辅助校验。
 *
 * 环境判定统一走 `isProductionEnv()`（读 APP_ENV）—— 与日志、密钥校验、驱动推导保持同一事实源。
 * 此处曾读 NODE_ENV，导致只设 APP_ENV=production 的部署（bare metal / 自定义镜像）
 * 会把 Better Auth 测试工具链暴露在生产认证面上。
 */
export const infraPlugins = [jwt(), openAPI(), ...(isProductionEnv() ? [] : [testUtils()])];
