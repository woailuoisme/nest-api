import { Can } from '@nestjs/authorization';
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  SerializeOptions,
  UploadedFile as UploadedFileDecorator,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-fastify/multipart';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { param } from '@/common/authorization/param.util';
import { UserPolicy } from '@/common/authorization/policies/user.policy';
import { UPLOAD } from '@/common/constants/app.constants';
import { CurrentUser, type CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ApiImageUpload, ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';
import { createUploadFileFilter, type MemoryUpload } from '@/common/storage/interfaces/upload.interface';

import { UserEntity, UserResourceSchema } from './users.dto';
import { UsersService } from './users.service';

/** 头像上传的表单字段名 — 原生 FileInterceptor 按字段名精确匹配，属对外契约的一部分 */
const AVATAR_FIELD_NAME = 'file';

/**
 * 用户自助控制器（前端 API）
 *
 * 提供当前用户信息、头像上传与用户详情查询等自助接口。
 * 管理端管理接口见 AdminUsersController（/admin/users）。
 */
@ApiTags('用户中心')
@ApiBearerAuth()
@Can.Anyone()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** 上传当前登录用户的头像图片 */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('me/avatar')
  @HttpCode(HttpStatus.OK)
  @ApiImageUpload({
    summary: '上传头像',
    fieldName: AVATAR_FIELD_NAME,
    description: '头像图片文件 (PNG/JPEG/WebP, 最大 2MB)',
  })
  @ApiSuccessResponse(UserResourceSchema, { description: '头像上传成功' })
  @SerializeOptions({ schema: UserResourceSchema })
  // 平台原生上传拦截器：字段名精确匹配 `file`；超限由 limits.fileSize 在流式写入中强制（413）
  @UseInterceptors(
    FileInterceptor(AVATAR_FIELD_NAME, {
      limits: { fileSize: UPLOAD.AVATAR.MAX_SIZE_BYTES },
      fileFilter: createUploadFileFilter({
        allowedMime: UPLOAD.ALLOWED_MIME_TYPES,
        allowedExt: UPLOAD.AVATAR.ALLOWED_EXTENSIONS,
      }),
    }),
  )
  async uploadAvatar(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFileDecorator() file?: MemoryUpload,
  ): Promise<UserEntity> {
    if (!file?.buffer) {
      throw new BadRequestException('未接收到文件');
    }
    return this.usersService.updateAvatar(user.id, file);
  }

  /** 获取当前登录用户的个人信息 */
  @Get('me')
  @ApiOperation({ summary: '个人信息' })
  @ApiSuccessResponse(UserResourceSchema, { description: '用户信息获取成功' })
  @SerializeOptions({ schema: UserResourceSchema })
  findMe(@CurrentUser() user: CurrentUserPayload): Promise<UserEntity> {
    return this.usersService.findOne(user.id);
  }

  /**
   * 根据用户 ID 获取指定用户详情
   *
   * 归属校验由 `@Can(UserPolicy, 'view', param('id'))` 在守卫阶段强制执行，
   * 防止任意登录用户枚举 UUIDv7 读取他人邮箱与角色（水平越权）。
   */
  @Get(':id')
  @Can(UserPolicy, 'view', param('id'))
  @ApiOperation({ summary: '用户详情' })
  @ApiSuccessResponse(UserResourceSchema, { description: '用户信息获取成功' })
  @SerializeOptions({ schema: UserResourceSchema })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserEntity> {
    return this.usersService.findOne(id);
  }
}
