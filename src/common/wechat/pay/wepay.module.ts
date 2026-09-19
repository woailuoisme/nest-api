import { Global, Module } from '@nestjs/common';
import { WepayService } from './wepay.service';

/**
 * 全局微信支付模块
 *
 * 导出 WepayService（下单 / 查询 / 退款 / 账单 / 回调验签解密），
 * 业务模块无需重复导入即可注入；驱动的 real / mock 装配与生产 fail-fast 校验在服务内部完成。
 */
@Global()
@Module({
  providers: [WepayService],
  exports: [WepayService],
})
export class WepayModule {}
