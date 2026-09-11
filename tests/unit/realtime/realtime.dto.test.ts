import { describe, expect, it } from 'vitest';
import { RealtimeSubscribeDto, RealtimeSubscribeSchema } from '@/realtime/dto/realtime.dto';

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

  it('RealtimeSubscribeDto 实例与 Schema 契约一致', () => {
    expect(RealtimeSubscribeDto).toBeDefined();
    expect(RealtimeSubscribeDto.schema).toBe(RealtimeSubscribeSchema);
  });
});
