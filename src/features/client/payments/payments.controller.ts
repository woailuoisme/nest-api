import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { Public } from '@/common/decorators/public.decorator';
import { BypassTransform } from '@/common/decorators/response.decorator';
import { ApiNoContentResponse } from '@/common/decorators/swagger-response.decorator';
import { WEPAY_HEADERS, type WepayNotifyHeaders } from '@/common/wechat/pay';
import type { RawBodyFastifyRequest } from '@/setup/plugins';

import { PaymentsService } from './payments.service';

/**
 * 支付回调控制器（客户端 API）
 *
 * 承载微信支付结果通知入口：无需鉴权（@Public），但必须通过签名与解密双重校验。
 * 成功返回 204 空体（微信仅判断状态码），失败交由全局异常过滤器输出 4xx/5xx 触发微信重投。
 */
@ApiTags('支付')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /** 接收微信支付结果通知 */
  @Public()
  @BypassTransform()
  @Post('wepay/notify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '微信支付回调' })
  @ApiNoContentResponse({ description: '回调已受理' })
  async handleWepayNotify(@Req() request: FastifyRequest): Promise<void> {
    await this.paymentsService.handleWepayNotify(this.extractNotifyHeaders(request), this.extractRawBody(request));
  }

  /** 提取微信回调签名头（Fastify 已将请求头名归一化为小写） */
  private extractNotifyHeaders(request: FastifyRequest): WepayNotifyHeaders {
    const read = (name: string): string | undefined => {
      const value = request.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    return {
      timestamp: read(WEPAY_HEADERS.TIMESTAMP),
      nonce: read(WEPAY_HEADERS.NONCE),
      signature: read(WEPAY_HEADERS.SIGNATURE),
      serial: read(WEPAY_HEADERS.SERIAL),
    };
  }

  /**
   * 提取原始报文
   *
   * 微信要求以原始 body 而非重新序列化的 JSON 验签，rawBody 由
   * NestJS 原生 `{ rawBody: true }` 挂载为 Buffer。
   */
  private extractRawBody(request: FastifyRequest): string {
    const raw = (request as RawBodyFastifyRequest).rawBody;
    if (Buffer.isBuffer(raw)) {
      return raw.toString('utf-8');
    }
    return typeof raw === 'string' ? raw : '';
  }
}
