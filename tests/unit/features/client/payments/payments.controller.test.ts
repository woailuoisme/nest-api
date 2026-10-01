import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { WEPAY_HEADERS } from '@/common/wechat/pay';
import { PaymentsController } from '@/features/client/payments/payments.controller';
import type { PaymentsService } from '@/features/client/payments/payments.service';

describe('PaymentsController', () => {
  const createMockService = () =>
    ({
      handleWepayNotify: vi.fn().mockResolvedValue(undefined),
    }) as unknown as PaymentsService;

  it('应正确提取微信回调签名请求头并透传给 Service', async () => {
    const service = createMockService();
    const controller = new PaymentsController(service);

    const mockRequest = {
      headers: {
        [WEPAY_HEADERS.TIMESTAMP]: '1700000000',
        [WEPAY_HEADERS.NONCE]: 'random-nonce',
        [WEPAY_HEADERS.SIGNATURE]: 'signature-string',
        [WEPAY_HEADERS.SERIAL]: 'serial-number',
      },
      rawBody: Buffer.from('{"id":"notify_1"}', 'utf-8'),
    } as unknown as FastifyRequest;

    await controller.handleWepayNotify(mockRequest);

    expect(service.handleWepayNotify).toHaveBeenCalledWith(
      {
        timestamp: '1700000000',
        nonce: 'random-nonce',
        signature: 'signature-string',
        serial: 'serial-number',
      },
      '{"id":"notify_1"}',
    );
  });

  it('当 rawBody 为 Buffer 时应将其解码为 utf-8 字符串', async () => {
    const service = createMockService();
    const controller = new PaymentsController(service);

    const mockRequest = {
      headers: {},
      rawBody: Buffer.from('{"event":"PAYMENT"}', 'utf-8'),
    } as unknown as FastifyRequest;

    await controller.handleWepayNotify(mockRequest);

    expect(service.handleWepayNotify).toHaveBeenCalledWith(expect.any(Object), '{"event":"PAYMENT"}');
  });

  it('当 rawBody 已经是 string 时应直接使用', async () => {
    const service = createMockService();
    const controller = new PaymentsController(service);

    const mockRequest = {
      headers: {},
      rawBody: '{"event":"STRING_BODY"}',
    } as unknown as FastifyRequest;

    await controller.handleWepayNotify(mockRequest);

    expect(service.handleWepayNotify).toHaveBeenCalledWith(expect.any(Object), '{"event":"STRING_BODY"}');
  });

  it('当 rawBody 为空或未设置时应回退为空字符串', async () => {
    const service = createMockService();
    const controller = new PaymentsController(service);

    const mockRequest = {
      headers: {},
    } as unknown as FastifyRequest;

    await controller.handleWepayNotify(mockRequest);

    expect(service.handleWepayNotify).toHaveBeenCalledWith(expect.any(Object), '');
  });

  it('当请求头值为数组时应提取首个元素', async () => {
    const service = createMockService();
    const controller = new PaymentsController(service);

    const mockRequest = {
      headers: {
        [WEPAY_HEADERS.TIMESTAMP]: ['1700000001', '1700000002'],
      },
      rawBody: '',
    } as unknown as FastifyRequest;

    await controller.handleWepayNotify(mockRequest);

    expect(service.handleWepayNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: '1700000001',
      }),
      '',
    );
  });
});
