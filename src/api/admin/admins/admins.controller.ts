import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import {
  ApiNoContentResponse,
  ApiPageResponse,
  ApiSuccessResponse,
} from '@/common/decorators/swagger-response.decorator';
import { PaginatedResultResource } from '@/common/dto/pagination.dto';
import { AdminItemResponse, AdminQueryRequest, CreateAdminRequest, UpdateAdminRequest } from './admins.dto';
import { AdminsService } from './admins.service';

@ApiTags('管理员管理')
@ApiBearerAuth()
@Controller('admin/admins')
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '管理员列表' })
  @ApiPageResponse(AdminItemResponse, { description: '管理员分页数据' })
  findAll(@Query() query: AdminQueryRequest): Promise<PaginatedResultResource<AdminItemResponse>> {
    return this.adminsService.findAll(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建管理员' })
  @ApiSuccessResponse(AdminItemResponse, { status: 201, description: '创建成功' })
  create(@Body() dto: CreateAdminRequest): Promise<AdminItemResponse> {
    return this.adminsService.create(dto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '管理员详情' })
  @ApiSuccessResponse(AdminItemResponse, { description: '获取成功' })
  findById(@Param('id', ParseIntPipe) id: number): Promise<AdminItemResponse> {
    return this.adminsService.findById(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '更新管理员' })
  @ApiSuccessResponse(AdminItemResponse, { description: '更新成功' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAdminRequest): Promise<AdminItemResponse> {
    return this.adminsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除管理员' })
  @ApiNoContentResponse({ description: '删除成功' })
  delete(@Param('id', ParseIntPipe) id: number, @CurrentUser('id') currentAdminId: number): Promise<void> {
    return this.adminsService.delete(id, currentAdminId);
  }
}
