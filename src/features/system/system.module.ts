import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { SystemController } from './system.controller';

/**
 * 系统/基础设施模块清单（统一系统探针端点：根心跳 `GET /` + 健康检查 `/health`）
 *
 * 由 API_MODULES 统一纳入 AppModule 与 CliModule，确保路由发现与容器上下文对齐。
 */
@Module({
  imports: [HealthModule],
  controllers: [SystemController],
  exports: [HealthModule],
})
export class SystemModule {}
