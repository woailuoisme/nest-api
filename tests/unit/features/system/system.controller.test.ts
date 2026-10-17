import { describe, expect, it } from 'vitest';

import { APP_VERSION } from '@/common/constants/app.constants';
import { SystemController } from '@/features/system/system.controller';

describe('SystemController', () => {
  const controller = new SystemController();

  it('getHello 应返回版本号与 ok 状态', () => {
    const result = controller.getHello();
    expect(result).toEqual({
      version: APP_VERSION,
      status: 'ok',
    });
  });
});
