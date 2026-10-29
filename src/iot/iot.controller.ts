import { Can } from '@nestjs/authorization';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { IotPolicy } from '@/common/authorization/policies/iot.policy';
import { Public } from '@/common/decorators/public.decorator';
import { ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';

import {
  CommandResponseEntity,
  DEFAULT_TENANT_ID,
  type DeviceCriticalEventDto,
  DeviceCriticalEventSchema,
  DeviceIdSchema,
  DeviceShadowEntity,
  DeviceShadowQuerySchema,
  type DeviceShadowQueryDto,
  type DeviceTokenRequestDto,
  DeviceTokenRequestSchema,
  DeviceTokenResponseDto,
  type MockTelemetryDto,
  MockTelemetrySchema,
  type SendCommandDto,
  SendCommandSchema,
} from './dto/iot.dto';
import { IotCommandService } from './services/iot-command.service';
import { IotTelemetryService } from './services/iot-telemetry.service';

/**
 * 物联网与设备控制接口
 *
 * 提供工业物联网设备的数字影子查询、遥测模拟上报与基于 MQTT 5.0 的同步 RPC 指令下发。
 */
@ApiTags('物联网与设备控制')
@ApiBearerAuth()
@Can(IotPolicy, 'accessDevices')
@Controller('iot/devices')
export class IotController {
  constructor(
    private readonly telemetryService: IotTelemetryService,
    private readonly commandService: IotCommandService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取设备影子列表' })
  @ApiSuccessResponse(DeviceShadowEntity, { isArray: true, description: '设备影子列表' })
  listDevices(@Query({ schema: DeviceShadowQuerySchema }) query: DeviceShadowQueryDto): DeviceShadowEntity[] {
    return this.telemetryService.listDeviceShadows(query.tenantId);
  }

  @Get(':deviceId/shadow')
  @ApiOperation({ summary: '查询设备实时状态影子' })
  @ApiSuccessResponse(DeviceShadowEntity, { description: '设备影子状态' })
  getShadow(
    @Param('deviceId', { schema: DeviceIdSchema }) deviceId: string,
    @Query({ schema: DeviceShadowQuerySchema }) query: DeviceShadowQueryDto,
  ): DeviceShadowEntity {
    return this.telemetryService.getDeviceShadowOrFail(query.tenantId ?? DEFAULT_TENANT_ID, deviceId);
  }

  @Post(':deviceId/command')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '向工业设备下发控制指令' })
  @ApiSuccessResponse(CommandResponseEntity, { description: '设备指令执行回执' })
  async sendCommand(
    @Param('deviceId', { schema: DeviceIdSchema }) deviceId: string,
    @Body({ schema: SendCommandSchema }) dto: SendCommandDto,
  ): Promise<CommandResponseEntity> {
    return this.commandService.sendCommand(deviceId, dto.command, dto.params, dto.timeoutMs);
  }

  @Post('token')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '签发设备认证凭据' })
  @ApiSuccessResponse(DeviceTokenResponseDto, { description: 'Mosquitto 认证专用 JWT 凭据' })
  issueDeviceToken(@Body({ schema: DeviceTokenRequestSchema }) dto: DeviceTokenRequestDto): DeviceTokenResponseDto {
    return this.telemetryService.issueDeviceToken(dto);
  }

  @Post('mock-telemetry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '模拟工业设备遥测上报' })
  @ApiSuccessResponse(DeviceShadowEntity, { description: '遥测上报成功并更新影子' })
  async mockTelemetry(@Body({ schema: MockTelemetrySchema }) dto: MockTelemetryDto): Promise<DeviceShadowEntity> {
    return this.telemetryService.simulateTelemetry(dto.tenantId, dto.deviceId, dto.telemetry);
  }

  @Post('mock-event')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '模拟工业设备硬件告警' })
  async mockEvent(
    @Body({ schema: DeviceCriticalEventSchema }) dto: DeviceCriticalEventDto,
  ): Promise<{ success: boolean }> {
    await this.telemetryService.simulateEvent(dto);
    return { success: true };
  }
}
