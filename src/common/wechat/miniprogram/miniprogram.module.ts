import { Global, Module } from '@nestjs/common';

import { MiniprogramService } from './miniprogram.service';

/**
 * 全局微信小程序服务端 API 模块
 *
 * 导出 MiniprogramService（凭证 / 登录 / 手机号 / 小程序码 / 内容安全 / 订阅消息），
 * 业务模块无需重复导入即可注入；驱动的 real / mock 装配与生产 fail-fast 校验在服务内部完成。
 *
 * 依赖 `RedisModule`（`@Global()`）提供的 `RedisService` 作为 access_token 的共享缓存，
 * 因此无需在此显式 import。
 */
@Global()
@Module({
  providers: [MiniprogramService],
  exports: [MiniprogramService],
})
export class MiniprogramModule {}
