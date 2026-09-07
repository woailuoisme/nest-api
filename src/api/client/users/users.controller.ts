import { BadRequestException, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ALLOWED_MIME_TYPES, UPLOAD } from '@/common/constants/app.constants';
import { Permission } from '@/common/constants/permissions';
import { CurrentUser, type CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';
import { UploadedFile as UploadedFileDecorator } from '@/common/decorators/uploaded.decorator';
import type { UploadedFile } from '@/common/storage/interfaces/upload.interface';
import { UserEntity } from './users.dto';
import { UsersService } from './users.service';

/**
 * 用户自助控制器（前端 API）
 *
 * 提供当前用户信息、头像上传与用户详情查询等自助接口。
 * 管理端管理接口见 AdminUsersController（/admin/users）。
 */
@ApiTags('用户中心')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** 上传当前登录用户的头像图片 */
  @Post('me/avatar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '上传头像' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '头像图片文件 (PNG/JPEG/WebP, 最大 2MB)',
        },
      },
      required: ['file'],
    },
  })
  @ApiSuccessResponse(UserEntity, { description: '头像上传成功' })
  async uploadAvatar(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFileDecorator({
      maxSize: UPLOAD.AVATAR.MAX_SIZE_BYTES,
      allowedMime: ALLOWED_MIME_TYPES,
      allowedExt: UPLOAD.AVATAR.ALLOWED_EXTENSIONS,
    })
    file: UploadedFile,
  ) {
    if (!file) {
      throw new BadRequestException('未接收到文件');
    }
    return this.usersService.updateAvatar(user.id, file);
  }

  /** 获取当前登录用户的个人信息 */
  @Get('me')
  @ApiOperation({ summary: '个人信息' })
  @ApiSuccessResponse(UserEntity, { description: '用户信息获取成功' })
  findMe(@CurrentUser() user: CurrentUserPayload) {
    return this.usersService.findOne(user.id);
  }

  /** 根据用户 ID 获取指定用户详情 */
  @Get(':id')
  @Permissions(Permission.UserRead)
  @ApiOperation({ summary: '用户详情' })
  @ApiSuccessResponse(UserEntity, { description: '用户信息获取成功' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }
}
