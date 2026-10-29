import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiKeysService } from '@/common/auth/api-keys.service';

import { ApiKeyCreateSchema, type ApiKeyCreateRequest, ApiKeyIdSchema } from './auth.schemas';

/**
 * API Key 管理端点（业务层，非官方包能力）。
 *
 * 官方 `ApiKeyProvider` 只负责请求期校验；密钥的签发 / 列举 / 吊销由应用自行实现。
 */
@ApiTags('认证')
@Can.Anyone()
@Controller('auth/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @ApiOperation({ summary: '创建 API Key' })
  create(@CurrentUser('id') userId: string, @Body({ schema: ApiKeyCreateSchema }) body: ApiKeyCreateRequest) {
    return this.apiKeysService.create(userId, body.name ?? null, body.expiresInDays);
  }

  @Get()
  @ApiOperation({ summary: '列出 API Key' })
  async list(@CurrentUser('id') userId: string) {
    return { apiKeys: await this.apiKeysService.list(userId) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '吊销 API Key' })
  async revoke(@CurrentUser('id') userId: string, @Param('id', { schema: ApiKeyIdSchema }) id: string): Promise<void> {
    if (!(await this.apiKeysService.revoke(userId, id))) {
      throw new NotFoundException('API key not found');
    }
  }
}
