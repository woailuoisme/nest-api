import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { APP_VERSION } from '@/common/constants/app.constants';
import { Public } from '@/common/decorators/public.decorator';

/** 系统根探针：`GET /` 返回服务版本与存活状态（VERSION_NEUTRAL，不受 /v1 前缀影响） */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller({ version: VERSION_NEUTRAL })
export class SystemController {
  @Get()
  getHello() {
    return {
      version: APP_VERSION,
      status: 'ok',
    };
  }
}
