import { FastifyAdapter } from '@nestjs/platform-fastify';
import qs from 'qs';

import { createRequestId } from './logger';

/**
 * 创建预配置的 FastifyAdapter 实例（集成全链路 Request ID 生成与扩展 QueryString 解析）
 */
export function createFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    trustProxy: true,
    genReqId: createRequestId,
    routerOptions: {
      querystringParser: (str: string) => qs.parse(str, { allowDots: true, comma: true, depth: 5 }),
    },
  });
}
