import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@/common/constants/roles';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiSuccessResponse } from '@/common/decorators/swagger-response.decorator';
import { CommandResponseEntity, DeviceShadowEntity, MockTelemetryDto, SendCommandDto } from './dto/iot.dto';
import { IotCommandService } from './services/iot-command.service';
import { IotTelemetryService } from './services/iot-telemetry.service';

/**
 * 物联网与设备控制接口
 *
 * 提供工业物联网设备的数字影子查询、遥测模拟上报与基于 MQTT 5.0 的同步 RPC 指令下发。
 */
@ApiTags('物联网与设备控制')
@ApiBearerAuth()
@Controller('iot/devices')
export class IotController {
  constructor(
    private readonly telemetryService: IotTelemetryService,
    private readonly commandService: IotCommandService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取全部设备影子列表' })
  @ApiSuccessResponse(DeviceShadowEntity, { isArray: true, description: '设备影子列表' })
  listDevices(): DeviceShadowEntity[] {
    return this.telemetryService.listDeviceShadows();
  }

  @Get(':deviceId/shadow')
  @ApiOperation({ summary: '查询设备实时状态影子' })
  @ApiSuccessResponse(DeviceShadowEntity, { description: '设备影子状态' })
  getShadow(@Param('deviceId') deviceId: string): DeviceShadowEntity {
    return this.telemetryService.getDeviceShadowOrFail(deviceId);
  }

  @Post(':deviceId/command')
  @Roles(Role.OPERATOR, Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '向工业设备下发控制指令' })
  @ApiSuccessResponse(CommandResponseEntity, { description: '设备指令执行回执' })
  async sendCommand(@Param('deviceId') deviceId: string, @Body() dto: SendCommandDto): Promise<CommandResponseEntity> {
    return this.commandService.sendCommand(deviceId, dto.command, dto.params, dto.timeoutMs);
  }

  @Post('mock-telemetry')
  @Roles(Role.OPERATOR, Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '模拟工业设备遥测上报' })
  @ApiSuccessResponse(DeviceShadowEntity, { description: '遥测上报成功并更新影子' })
  async mockTelemetry(@Body() dto: MockTelemetryDto): Promise<DeviceShadowEntity> {
    return this.telemetryService.simulateTelemetry(dto.tenantId, dto.deviceId, dto.telemetry);
  }
}
