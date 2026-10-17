import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';

import { BYPASS_LOAD_SHEDDING_KEY, TRAFFIC_PRIORITY_KEY } from '../decorators/load-shedding.decorator.js';
import { TrafficPriority } from '../enum/index.js';
import { SystemLoadSampler } from '../samplers/index.js';
import { calculateJitteredRetryAfter } from '../utils/index.js';

/**
 * 生产级入站自适应分级负载脱落守卫 (Priority-Aware Adaptive LoadSheddingGuard)
 *
 * 遵循 Google SRE 分级脱落标准与 AWS Jitter 惊群抑制：
 * - 结合端点声明的 @TrafficPriorityLevel (CRITICAL / DEFAULT / SHEDDABLE)，依据阶梯水位智能裁决；
 * - 轻度过载优先脱落 SHEDDABLE（报表/埋点/推荐），释放 CPU 与堆内存保障核心业务；
 * - 中度过载脱落 DEFAULT 日常流量；极重度过载才触碰 CRITICAL 核心生命线；
 * - 脱落时下发动态 Jitter 的 Retry-After (秒) 与 X-Retry-After-Ms (毫秒) + X-Load-Shed-Priority 追踪头，抑制惊群雪崩。
 */
@Injectable()
export class LoadSheddingGuard implements CanActivate {
  private readonly logger = new Logger(LoadSheddingGuard.name);

  private readonly baseRetryAfterSeconds = 5;

  constructor(
    private readonly reflector: Reflector,
    private readonly sampler: SystemLoadSampler,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    // 检查是否显式豁免（如健康检查探针）
    const isBypassed = this.reflector.getAllAndOverride<boolean>(BYPASS_LOAD_SHEDDING_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isBypassed) {
      return true;
    }

    // 提取当前端点的流量优先级（优先 Handler，次之 Controller 类，默认 DEFAULT）
    const priority =
      this.reflector.getAllAndOverride<TrafficPriority>(TRAFFIC_PRIORITY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? TrafficPriority.DEFAULT;

    const shedResult = this.sampler.shouldShed(priority);
    if (shedResult.shouldShed) {
      const reply = context.switchToHttp().getResponse<FastifyReply>();
      const retryAfterSeconds = calculateJitteredRetryAfter(this.baseRetryAfterSeconds);
      reply?.header?.('Retry-After', retryAfterSeconds.toString());
      reply?.header?.('X-Retry-After-Ms', (retryAfterSeconds * 1000).toString());
      reply?.header?.('X-Load-Shed-Priority', priority);

      const logPayload = {
        msg: `Inbound request shed due to system overload [Priority: ${priority}]`,
        priority,
        reason: shedResult.reason,
      };

      if (priority === TrafficPriority.SHEDDABLE) {
        this.logger.log(logPayload);
      } else if (priority === TrafficPriority.DEFAULT) {
        this.logger.warn(logPayload);
      } else {
        this.logger.error(logPayload);
      }

      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: `Server is currently overloaded [Priority: ${priority}], please retry later`,
        reason: shedResult.reason,
        priority,
      });
    }

    return true;
  }
}
