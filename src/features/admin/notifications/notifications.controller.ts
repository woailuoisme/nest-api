import { Can } from '@nestjs/authorization';
import { Body, Controller, Post, SerializeOptions } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { omit } from 'es-toolkit';

import { AdminPolicy } from '@/common/authorization/policies/admin.policy';
import { ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';

import {
  NotificationEntitySchema,
  type NotificationPayload,
  type SendNotificationDto,
  SendNotificationSchema,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * 管理后台 — 实时通知推送控制器
 *
 * 挂载于 /admin 前缀，准入由 AdminPolicy 的能力判定（ADMIN / OPERATOR，SUPER_ADMIN 直通）。
 */
@ApiTags('消息通知')
@ApiBearerAuth()
@Can(AdminPolicy, 'sendNotification')
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({ summary: '发送通知' })
  @ApiSuccessResponse(NotificationEntitySchema, { status: 201, description: '事件推送成功' })
  @SerializeOptions({ schema: NotificationEntitySchema })
  @Post('send')
  send(@Body({ schema: SendNotificationSchema }) dto: SendNotificationDto): NotificationPayload {
    return this.notificationsService.sendToUser(dto.userId, omit(dto, ['userId']));
  }
}
