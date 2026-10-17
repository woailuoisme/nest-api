import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ChannelExplorerService } from '@/realtime/channels/channel-explorer.service';
import { ChannelManager } from '@/realtime/channels/channel-manager.service';
import { CHANNEL_AUTH_METADATA, ChannelAuth } from '@/realtime/channels/decorators/channel-auth.decorator';

class TestFeatureService {
  @ChannelAuth('private:orders.{orderId}')
  authorizeOrder(user: CurrentUserPayload, params: Record<string, string>): boolean {
    return params.orderId === '1001' && user.role === Role.USER;
  }

  @ChannelAuth('presence:room.{roomId}')
  async authorizeRoom(user: CurrentUserPayload, params: Record<string, string>): Promise<boolean> {
    return params.roomId.startsWith('vip-') && user.id === 'user-1';
  }

  regularMethod(): string {
    return 'hello';
  }
}

class FaultyService {
  @ChannelAuth('private:crash.{id}')
  crashMethod(): boolean {
    throw new Error('Database disconnected');
  }
}

describe('ChannelAuth Decorator & ChannelExplorerService', () => {
  let discoveryService: DiscoveryService;
  let metadataScanner: MetadataScanner;
  let reflector: Reflector;
  let channelManager: ChannelManager;
  let explorer: ChannelExplorerService;

  const mockUser: CurrentUserPayload = {
    id: 'user-1',
    email: 'test@example.com',
    role: Role.USER,
  };

  beforeEach(() => {
    channelManager = new ChannelManager();
    metadataScanner = new MetadataScanner();
    reflector = new Reflector();

    discoveryService = {
      getProviders: vi.fn().mockReturnValue([]),
    } as unknown as DiscoveryService;

    explorer = new ChannelExplorerService(discoveryService, metadataScanner, reflector, channelManager);
  });

  describe('@ChannelAuth 装饰器元数据挂载', () => {
    it('应在方法上正确标记 CHANNEL_AUTH_METADATA', () => {
      const service = new TestFeatureService();
      const metadata = reflector.get(CHANNEL_AUTH_METADATA, service.authorizeOrder);

      expect(metadata).toEqual({
        pattern: 'private:orders.{orderId}',
      });
    });
  });

  describe('ChannelExplorerService.explore() 自省与自动注册', () => {
    it('应扫描 Providers 并将 @ChannelAuth 标记的方法注册到 ChannelManager', async () => {
      const testService = new TestFeatureService();
      const wrappers: InstanceWrapper[] = [
        {
          instance: testService,
        } as InstanceWrapper,
      ];

      vi.spyOn(discoveryService, 'getProviders').mockReturnValue(wrappers);

      explorer.explore();

      // 验证 private:orders.{orderId} 规则
      const orderAllowed = await channelManager.canSubscribe(mockUser, 'private:orders.1001');
      expect(orderAllowed.authorized).toBe(true);

      const orderDenied = await channelManager.canSubscribe(mockUser, 'private:orders.9999');
      expect(orderDenied.authorized).toBe(false);

      // 验证 presence:room.{roomId} 异步规则
      const roomAllowed = await channelManager.canSubscribe(mockUser, 'presence:room.vip-888');
      expect(roomAllowed.authorized).toBe(true);

      const roomDenied = await channelManager.canSubscribe(mockUser, 'presence:room.public-123');
      expect(roomDenied.authorized).toBe(false);
    });

    it('当被装饰方法内部抛出异常时，ChannelManager 应安全捕获并返回 authorized: false', async () => {
      const faultyService = new FaultyService();
      const wrappers: InstanceWrapper[] = [
        {
          instance: faultyService,
        } as InstanceWrapper,
      ];

      vi.spyOn(discoveryService, 'getProviders').mockReturnValue(wrappers);

      explorer.explore();

      const result = await channelManager.canSubscribe(mockUser, 'private:crash.42');
      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('Internal authorization error');
    });

    it('对空实例、无原型或未标记装饰器的方法应静默跳过', () => {
      const emptyWrappers: InstanceWrapper[] = [
        { instance: null } as unknown as InstanceWrapper,
        { instance: 'not-an-object' } as unknown as InstanceWrapper,
        { instance: Object.create(null) } as unknown as InstanceWrapper,
      ];

      vi.spyOn(discoveryService, 'getProviders').mockReturnValue(emptyWrappers);

      expect(() => explorer.explore()).not.toThrow();
    });

    it('onApplicationBootstrap 应触发 explore() 流程', () => {
      const exploreSpy = vi.spyOn(explorer, 'explore').mockImplementation(() => {});
      explorer.onApplicationBootstrap();
      expect(exploreSpy).toHaveBeenCalledTimes(1);
    });
  });
});
