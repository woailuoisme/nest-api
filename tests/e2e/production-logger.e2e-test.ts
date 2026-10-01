/**
 * 生产形态引导契约（最小装配，不依赖任何外部基础设施）
 *
 * 守住两件事：
 * 1. `APP_ENV=production` 下真实 DI 引导可用：`createPinoLogger` 是 async 工厂，
 *    生产分支（JSON 通道 / base / ISO 时间）必须能被 Nest 正常解析；
 * 2. 生产落点是 stdout JSON 通道（fd 1），而不是 `pino-pretty` 的 Transform。
 *
 * 分工说明：本用例跑在含 devDependencies 的环境里，因此**不能**覆盖「生产镜像缺 `pino-pretty`」
 * 那一类启动期崩溃 —— 那由 `tests/unit/setup/logger.config.test.ts` 的模块缺失 mock 锁定；
 * 这里覆盖的是「生产分支在真实引导链路里可用」。
 */
import { Test } from '@nestjs/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoggerModule } from '@/setup/logger/logger.module';
import { PINO_LOGGER } from '@/setup/logger/pino-logger.service';

/** pino 把落点流挂在内部 symbol 上，官方 d.ts 未暴露索引签名 */
const getStreamFd = (logger: pino.Logger): number | undefined =>
  (logger as unknown as Record<symbol, { fd?: number }>)[pino.symbols.streamSym]?.fd;

const getChindings = (logger: pino.Logger): string =>
  String((logger as unknown as Record<symbol, unknown>)[pino.symbols.chindingsSym]);

describe('生产形态引导（APP_ENV=production）', () => {
  const originalAppEnv = process.env.APP_ENV;
  let logger: pino.Logger;

  beforeAll(async () => {
    process.env.APP_ENV = 'production';
    // LoggerModule 无外部依赖（无 ConfigService / DB / Redis），故可独立装配
    const moduleRef = await Test.createTestingModule({ imports: [LoggerModule] }).compile();
    logger = moduleRef.get<pino.Logger>(PINO_LOGGER);
  });

  afterAll(() => {
    process.env.APP_ENV = originalAppEnv;
  });

  it('生产分支可完成引导，且落点为 stdout JSON 通道', () => {
    expect(logger.level).toBe('info');
    expect(getStreamFd(logger)).toBe(1);
    expect(getChindings(logger)).toContain('"service"');
    expect(getChindings(logger)).toContain('"hostname"');
  });
});
