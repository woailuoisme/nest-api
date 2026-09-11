import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { ChannelAuthorizer } from './channel.types';
import { ChannelManager } from './channel-manager.service';
import { CHANNEL_AUTH_METADATA, type ChannelAuthMetadata } from './decorators/channel-auth.decorator';

/**
 * 实时频道声明式授权自省服务
 *
 * 在应用引导就绪阶段扫描所有注入的 Providers，提取被 @ChannelAuth 标记的方法并挂载至 ChannelManager，
 * 彻底消除手动调用 register() 模板代码，实现各业务 Feature 的自包含与高内聚。
 */
@Injectable()
export class ChannelExplorerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChannelExplorerService.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly channelManager: ChannelManager,
  ) {}

  onApplicationBootstrap(): void {
    this.explore();
  }

  /**
   * 扫描所有 Provider 中标记有 @ChannelAuth 的方法并注册进 ChannelManager
   */
  explore(): void {
    const providers = this.discoveryService.getProviders();

    for (const wrapper of providers) {
      const { instance } = wrapper;
      if (!instance || typeof instance !== 'object') {
        continue;
      }

      const prototype = Object.getPrototypeOf(instance);
      if (!prototype) {
        continue;
      }

      const methodNames = this.metadataScanner.getAllMethodNames(prototype);

      for (const methodName of methodNames) {
        const targetCallback = (instance as Record<string, unknown>)[methodName];
        if (typeof targetCallback !== 'function') {
          continue;
        }

        const metadata = this.reflector.get<ChannelAuthMetadata | undefined>(CHANNEL_AUTH_METADATA, targetCallback);

        if (!metadata?.pattern) {
          continue;
        }

        const authorizer: ChannelAuthorizer = (user, params) => {
          return targetCallback.call(instance, user, params);
        };

        this.channelManager.register(metadata.pattern, authorizer);
        this.logger.log(`发现实时频道授权规则: [${metadata.pattern}] -> ${instance.constructor.name}.${methodName}()`);
      }
    }
  }
}
