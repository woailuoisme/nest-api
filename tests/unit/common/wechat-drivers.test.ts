import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { MiniprogramService } from '@/common/wechat/miniprogram/miniprogram.service';
import { WepayService } from '@/common/wechat/pay/wepay.service';
import type { EnvConfig } from '@/config/env.validation';
import { RedisService } from '@/database/redis.service';

/**
 * 驱动装配降级语义：未配置凭证必须自动降级为 mock；
 * 显式指定 real 但凭证缺失则启动即抛（失败时机前移，防止运行期才发现配置缺失）。
 */

/** 最小 ConfigService 桩：仅覆盖驱动装配读取的键 */
const fakeConfig = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService<EnvConfig, true>;

/** MiniprogramService 构造所需的最小 RedisService 桩（mock 驱动不触达缓存） */
const fakeRedis = {} as RedisService;

describe('wechat 驱动装配', () => {
  it('wepay 未配置凭证时自动降级为 mock', () => {
    const service = new WepayService(fakeConfig({}));
    expect(service.driverName).toBe('mock');
  });

  it('miniprogram 未配置凭证时自动降级为 mock', () => {
    const service = new MiniprogramService(fakeConfig({}), fakeRedis);
    expect(service.driverName).toBe('mock');
  });

  it('miniprogram 显式 real 但凭证缺失时启动即抛', () => {
    expect(() => new MiniprogramService(fakeConfig({ MINIPROGRAM_DRIVER: 'real' }), fakeRedis)).toThrow(
      /MINIPROGRAM_APPID \/ MINIPROGRAM_APPSECRET/,
    );
  });

  it('wepay 显式 real 但凭证缺失时启动即抛', () => {
    expect(() => new WepayService(fakeConfig({ WEPAY_DRIVER: 'real' }))).toThrow();
  });
});
