import { describe, expect, it } from 'vitest';
import { CentrifugoProxySubscribeSchema, RealtimeSubscribeSchema } from '@/realtime/dto/realtime.dto';

describe('RealtimeSubscribeDto & Schema', () => {
  it('合法的订阅载荷应成功解析', () => {
    const validData = {
      channel: 'private:orders',
      client: 'client-123456',
    };

    const parsed = RealtimeSubscribeSchema.parse(validData);
    expect(parsed.channel).toBe('private:orders');
    expect(parsed.client).toBe('client-123456');
  });

  it('省略 client 可选字段时应正常通过', () => {
    const validData = {
      channel: 'public:system-notices',
    };

    const parsed = RealtimeSubscribeSchema.parse(validData);
    expect(parsed.channel).toBe('public:system-notices');
    expect(parsed.client).toBeUndefined();
  });

  it('channel 为空字符串时应抛出校验异常', () => {
    const invalidData = {
      channel: '',
    };

    expect(() => RealtimeSubscribeSchema.parse(invalidData)).toThrow('channel 不能为空');
  });

  it('缺少 channel 字段时应抛出校验异常', () => {
    const invalidData = {
      client: 'client-abc',
    };

    expect(() => RealtimeSubscribeSchema.parse(invalidData)).toThrow();
  });

  it('channel 非字符串类型时应被拒绝', () => {
    const invalidData = {
      channel: 12345,
    };

    expect(() => RealtimeSubscribeSchema.parse(invalidData)).toThrow();
  });
});

describe('CentrifugoProxySubscribeDto & Schema', () => {
  it('合法的 Proxy Subscribe Webhook 载荷应成功解析', () => {
    const validData = {
      client: 'client-xyz',
      transport: 'websocket',
      protocol: 'json',
      encoding: 'json',
      user: 'usr_abc123',
      channel: 'private:notifications.usr_abc123',
    };

    const parsed = CentrifugoProxySubscribeSchema.parse(validData);
    expect(parsed.client).toBe('client-xyz');
    expect(parsed.user).toBe('usr_abc123');
    expect(parsed.channel).toBe('private:notifications.usr_abc123');
  });

  it('缺省 user 时应赋予默认空字符串', () => {
    const data = {
      channel: 'public:general',
    };

    const parsed = CentrifugoProxySubscribeSchema.parse(data);
    expect(parsed.user).toBe('');
    expect(parsed.channel).toBe('public:general');
  });

  it('channel 为空时应抛出校验异常', () => {
    expect(() => CentrifugoProxySubscribeSchema.parse({ channel: '' })).toThrow('channel 不能为空');
  });
});
