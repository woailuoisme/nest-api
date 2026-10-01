import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { EnvConfig } from '@/config/env.validation';
import { setupBullBoard } from './bull-board';
import { setupApiDocumentation } from './swagger';

/** 成功挂载的运维面板描述（标签用于启动日志，与历史输出逐字一致） */
export interface MountedPanel {
  label: string;
  url: string;
}

/**
 * 运维面板编排器：统一挂载 BullBoard 队列看板与 Scalar API 文档。
 * 门禁策略集中于此处：面板自身拒绝挂载（如生产环境缺少访问凭据）时静默跳过；
 * API 文档额外受 SWAGGER_ENABLED 开关控制。仅 HTTP 进程调用（CLI 无 Fastify 实例）。
 * @returns 已成功挂载的面板列表，供启动日志输出
 */
export async function registerOpsPanels(app: NestFastifyApplication): Promise<MountedPanel[]> {
  const config = app.get(ConfigService<EnvConfig, true>);
  const appUrl = config.get('APP_URL');

  const bullBoardUrl = await setupBullBoard(app, appUrl);
  const docUrls = config.get('SWAGGER_ENABLED') ? await setupApiDocumentation(app, appUrl) : null;

  const panels: MountedPanel[] = [];
  if (docUrls) {
    panels.push({ label: 'Docs', url: docUrls.clientDocsUrl });
    panels.push({ label: 'Admin', url: docUrls.adminDocsUrl });
    panels.push({ label: 'Auth', url: docUrls.authDocsUrl });
  }
  if (bullBoardUrl) {
    panels.push({ label: 'Queues', url: bullBoardUrl });
  }
  return panels;
}
