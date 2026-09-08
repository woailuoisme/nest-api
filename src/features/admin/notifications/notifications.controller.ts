import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { omit } from 'es-toolkit';
import { ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';
import { NotificationEntity, type NotificationPayload, SendNotificationDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * 管理后台 — 实时通知推送控制器
 *
 * 挂载于 /admin 前缀，准入由全局 AdminPrefixGuard 默认拒绝式强制（仅 ADMIN）。
 */
@ApiTags('消息通知')
@ApiBearerAuth()
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({ summary: '发送通知' })
  @ApiSuccessResponse(NotificationEntity, { status: 201, description: '事件推送成功' })
  @Post('send')
  send(@Body() dto: SendNotificationDto): NotificationPayload {
    return this.notificationsService.sendToUser(dto.userId, omit(dto, ['userId']));
  }
}
