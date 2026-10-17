/**
 * AuthService 单元测试
 */
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { auth } from '@/common/auth/better-auth';
import { AuthService } from '@/features/client/auth/auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AuthService],
    }).compile();

    service = module.get(AuthService);
  });

  it('应注入并暴露 auth 实例与 api', () => {
    expect(service.auth).toBe(auth);
    expect(service.api).toBe(auth.api);
  });
});
