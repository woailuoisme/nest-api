import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@/common/constants/permissions';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  ApiNoContentResponse,
  ApiPageResponse,
  ApiSuccessResponse,
} from '@/common/decorators/swagger-response.decorator';
import type { PaginatedResultResource } from '@/common/dto/pagination.dto';
import { Idempotent } from '@/common/idempotency';

import {
  type ChangeRoleRequest,
  ChangeRoleSchema,
  type CreateUserRequest,
  CreateUserSchema,
  type FindUsersRequest,
  FindUsersSchema,
  type SearchUsersRequest,
  SearchUsersSchema,
  type UpdateUserRequest,
  UpdateUserSchema,
  UserEntity,
  UserPageResourceSchema,
  UserResourceSchema,
} from './users.dto';
import { UsersService } from './users.service';

/**
 * 管理后台 — 用户管理控制器
 *
 * 挂载于 /admin 前缀，准入由全局 AdminPrefixGuard 默认拒绝式强制（仅 ADMIN）。
 * 细粒度权限仍以 @Permissions 标注语义，供 AccessControlGuard 消费与未来角色扩展。
 */
@ApiTags('用户管理')
@ApiBearerAuth()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  /** 创建新用户（需 UserCreate 权限，支持 Idempotency-Key 幂等写入） */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  @Permissions(Permission.UserCreate)
  @ApiOperation({ summary: '创建用户' })
  @ApiSuccessResponse(UserResourceSchema, { status: 201, description: '用户创建成功' })
  @SerializeOptions({ schema: UserResourceSchema })
  create(@Body({ schema: CreateUserSchema }) dto: CreateUserRequest): Promise<UserEntity> {
    return this.usersService.create(dto);
  }

  /** 全文搜索用户（支持 Meilisearch 检索与角色过滤） */
  @Get('search')
  @Permissions(Permission.UserRead)
  @ApiOperation({ summary: '搜索用户' })
  @ApiPageResponse(UserResourceSchema, { description: '搜索命中用户列表' })
  @SerializeOptions({ schema: UserPageResourceSchema })
  search(
    @Query({ schema: SearchUsersSchema }) query: SearchUsersRequest,
  ): Promise<PaginatedResultResource<UserEntity>> {
    return this.usersService.search(query);
  }

  /** 分页获取用户列表，支持按关键字和角色筛选 */
  @Get()
  @Permissions(Permission.UserRead)
  @ApiOperation({ summary: '用户列表' })
  @ApiPageResponse(UserResourceSchema, { description: '分页用户列表' })
  @SerializeOptions({ schema: UserPageResourceSchema })
  findAll(@Query({ schema: FindUsersSchema }) query: FindUsersRequest): Promise<PaginatedResultResource<UserEntity>> {
    return this.usersService.findAll(query);
  }

  /** 根据用户 ID 更新用户信息 */
  @Patch(':id')
  @Permissions(Permission.UserUpdate)
  @ApiOperation({ summary: '更新用户' })
  @ApiSuccessResponse(UserResourceSchema, { description: '用户信息更新成功' })
  @SerializeOptions({ schema: UserResourceSchema })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: UpdateUserSchema }) dto: UpdateUserRequest,
  ): Promise<UserEntity> {
    return this.usersService.update(id, dto);
  }

  /** 变更指定用户的系统角色 */
  @Patch(':id/role')
  @ApiOperation({ summary: '变更角色' })
  @ApiSuccessResponse(UserResourceSchema, { description: '用户角色更新成功' })
  @SerializeOptions({ schema: UserResourceSchema })
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: ChangeRoleSchema }) dto: ChangeRoleRequest,
  ): Promise<UserEntity> {
    return this.usersService.changeRole(id, dto.role);
  }

  /** 根据用户 ID 物理删除指定用户（需 UserDelete 权限） */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(Permission.UserDelete)
  @ApiOperation({ summary: '删除用户' })
  @ApiNoContentResponse({ description: '用户删除成功' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.usersService.remove(id);
  }
}
