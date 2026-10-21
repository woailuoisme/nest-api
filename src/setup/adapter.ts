import { FastifyAdapter } from '@nestjs/platform-fastify';
import qs from 'qs';

import { isProductionEnv, isTruthyEnv } from '@/common/constants/app.constants';

import { createRequestId } from './logger';

/** `trustProxy` 支持的类型（与 Fastify 的类型声明严格对齐） */
type TrustProxyOption = boolean | string | string[];

/** 等价于「信任全部来源」的通配 CIDR */
const UNIVERSAL_PROXY_CIDRS = new Set(['0.0.0.0/0', '::/0']);

/**
 * 解析 `TRUST_PROXY` 为 Fastify 可消费的形态：`false`（默认）/ `true`（仅限非生产）/ CIDR 列表。
 *
 * 引导期直接读 `process.env`（适配器创建早于 ConfigModule 生效）。
 *
 * 两个不接受的写法故意抛错而非静默降级：
 * - `true` 在 Fastify 语义下是「信任全部跳数」，`req.ip` 会取 X-Forwarded-For 最左值（客户端可控），
 *   而 `req.ip` 是限流与幂等作用域的输入 —— 生产环境用 true 等于关掉按 IP 限流；
 * - 跳数（如 `2`）不在 Fastify 类型声明内，直接传给 proxy-addr 会在启动时崩溃。
 */
export function resolveTrustProxy(raw?: string): TrustProxyOption {
  const value = raw?.trim();
  if (!value) return false;
  if (value.toLowerCase() === 'false') return false;

  if (isTruthyEnv(value)) {
    if (isProductionEnv()) {
      throw new Error(
        'TRUST_PROXY=true 在生产环境不可用（等于信任任意 X-Forwarded-For）：请改为网关 CIDR，例如 TRUST_PROXY=172.16.0.0/12',
      );
    }
    return true;
  }

  if (/^\d+$/.test(value)) {
    throw new Error(`TRUST_PROXY=${value} 无效：不支持按跳数信任，请改为网关 CIDR 列表`);
  }

  const list = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length === 0) return false;

  // 全通配 CIDR 等价于 true（信任任意 X-Forwarded-For），生产环境一律拒绝
  if (isProductionEnv() && list.some((item) => UNIVERSAL_PROXY_CIDRS.has(item))) {
    throw new Error(`TRUST_PROXY=${value} 在生产环境等价于信任任意来源：请填写网关实际 CIDR`);
  }

  return list.length === 1 ? list[0] : list;
}

/**
 * 创建预配置的 FastifyAdapter 实例（集成全链路 Request ID 生成与扩展 QueryString 解析）
 */
export function createFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    // 默认不信任 X-Forwarded-For：req.ip 同时是限流与幂等作用的输入，
    // 无条件信任会让客户端通过伪造头绕过按 IP 限流 / 伪装幂等作用域。
    // 仅当 API 确实只经网关暴露时，将 TRUST_PROXY 指向网关所在 CIDR。
    trustProxy: resolveTrustProxy(process.env.TRUST_PROXY),
    genReqId: createRequestId,
    routerOptions: {
      querystringParser: (str: string) => qs.parse(str, { allowDots: true, comma: true, depth: 5 }),
    },
  });
}
