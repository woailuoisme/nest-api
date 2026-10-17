import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Queue } from 'bullmq';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { isProductionEnv } from '@/common/constants/app.constants';
import { DEMO_QUEUE, MAIL_QUEUE, MEDIA_QUEUE, TOKEN_CLEANUP_QUEUE } from '@/common/constants/queues';
import { matchesBasicAuth } from '@/common/utils/basic-auth.util';
import type { EnvConfig } from '@/config/env.validation';

/** 仅暴露所需 Hook API 的最小 Fastify 接口（规避 platform-fastify 嵌套 fastify 类型差异） */
type FastifyLike = {
  addHook: (event: 'onRequest', hook: (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void) => void;
};

/** BullBoard 队列监控面板路径 */
export const QUEUES_DASHBOARD_PATH = '/queues';

/** 纳入队列看板的队列名（只读模式；当前不含 SEARCH_QUEUE） */
const MONITORED_QUEUE_NAMES = [MAIL_QUEUE, TOKEN_CLEANUP_QUEUE, DEMO_QUEUE, MEDIA_QUEUE];

/**
 * 挂载 BullBoard 队列监控面板。
 * 默认直接开放访问；若配置了 BULL_BOARD_USER / BULL_BOARD_PASSWORD 则启用 Basic Auth 鉴权。
 * 仅 HTTP 进程调用（CLI 无 Fastify 实例）。
 * @returns 队列监控面板的完整访问 URL
 */
export async function setupBullBoard(app: NestFastifyApplication, appUrl?: string): Promise<string> {
  const config = app.get(ConfigService<EnvConfig, true>);
  const boardUser = config.get('BULL_BOARD_USER');
  const boardPass = config.get('BULL_BOARD_PASSWORD');

  // 生产环境未配置访问凭据时拒绝挂载，防止队列载荷（邮件、令牌、用户数据）泄漏
  if (isProductionEnv() && (!boardUser || !boardPass)) {
    return '';
  }

  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath(QUEUES_DASHBOARD_PATH);

  createBullBoard({
    queues: MONITORED_QUEUE_NAMES.map(
      (name) => new BullMQAdapter(app.get<Queue>(getQueueToken(name)), { readOnlyMode: true }),
    ),
    serverAdapter,
  });

  type RegisterPlugin = Parameters<typeof app.register>[0];
  await app.register(serverAdapter.registerPlugin() as unknown as RegisterPlugin, {
    prefix: QUEUES_DASHBOARD_PATH,
  });

  // 若显式配置了账号密码则启用 Basic Auth，未配置则直接放行
  if (boardUser && boardPass) {
    const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyLike;
    fastify.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith(QUEUES_DASHBOARD_PATH)) return;
      if (matchesBasicAuth(request.headers.authorization, boardUser, boardPass)) return;
      await reply
        .code(401)
        .header('WWW-Authenticate', 'Basic realm="bull-board"')
        .send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Unauthorized',
          },
        });
    });
  }

  return appUrl ? `${appUrl}${QUEUES_DASHBOARD_PATH}` : QUEUES_DASHBOARD_PATH;
}
