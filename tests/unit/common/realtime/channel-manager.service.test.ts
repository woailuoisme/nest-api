import { beforeEach, describe, expect, it } from 'vitest';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ChannelManager } from '@/common/realtime/channels/channel-manager.service';

describe('ChannelManager', () => {
  let manager: ChannelManager;
  let user: CurrentUserPayload;
  let admin: CurrentUserPayload;

  beforeEach(() => {
    manager = new ChannelManager();
    user = { id: '01931234-0000-7000-8000-000000000042', email: 'user@example.com', role: Role.USER };
    admin = { id: '01931234-0000-7000-8000-000000000001', email: 'admin@example.com', role: Role.ADMIN };
  });

  describe('内置用户私有频道规则: private:user.{userId}', () => {
    it('当前认证用户订阅自身私有频道应允许', async () => {
      const result = await manager.canSubscribe(user, `private:user.${user.id}`);
      expect(result.authorized).toBe(true);
    });

    it('当前认证用户试图订阅其他用户私有频道应拒绝', async () => {
      const result = await manager.canSubscribe(user, 'private:user.01931234-0000-7000-8000-999999999999');
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain('forbidden');
    });

    it('Pusher 标准 private-user.{userId} 连字符前缀应与 private:user.{userId} 规则完全等价识别', async () => {
      const allowed = await manager.canSubscribe(user, `private-user.${user.id}`);
      const denied = await manager.canSubscribe(user, 'private-user.01931234-0000-7000-8000-999999999999');
      expect(allowed.authorized).toBe(true);
      expect(denied.authorized).toBe(false);
    });
  });

  describe('内置管理员私有频道规则: private:admin.*', () => {
    it('ADMIN 角色订阅任意 private:admin.* 频道应允许', async () => {
      const result = await manager.canSubscribe(admin, 'private:admin.financial_metrics');
      expect(result.authorized).toBe(true);
    });

    it('普通 USER 角色订阅 private:admin.* 频道应拒绝', async () => {
      const result = await manager.canSubscribe(user, 'private:admin.financial_metrics');
      expect(result.authorized).toBe(false);
    });
  });

  describe('公共频道放行与未注册私有频道拦截', () => {
    it('公共频道（如 public:* 或 dashboard:*）应默认放行', async () => {
      const res1 = await manager.canSubscribe(user, 'public:announcements');
      const res2 = await manager.canSubscribe(user, 'dashboard:system');
      expect(res1.authorized).toBe(true);
      expect(res2.authorized).toBe(true);
    });

    it('未注册鉴权规则的 private:* 频道应默认安全拒绝 (Fail-Safe)', async () => {
      const res = await manager.canSubscribe(user, 'private:secret.vault');
      expect(res.authorized).toBe(false);
      expect(res.reason).toContain('No authorization rule defined');
    });

    it('未注册鉴权规则的 presence:* 频道应默认安全拒绝 (Fail-Safe)', async () => {
      const res = await manager.canSubscribe(user, 'presence:secret-room');
      expect(res.authorized).toBe(false);
      expect(res.reason).toContain('No authorization rule defined');
    });
  });

  describe('动态自定义规则注册', () => {
    it('支持多级参数解析与异步授权校验', async () => {
      manager.register('private:org.{orgId}.project.{projectId}', async (currentUser, params) => {
        return params.orgId === '10' && params.projectId === '20' && currentUser.id === user.id;
      });

      const success = await manager.canSubscribe(user, 'private:org.10.project.20');
      const fail = await manager.canSubscribe(user, 'private:org.10.project.99');

      expect(success.authorized).toBe(true);
      expect(fail.authorized).toBe(false);
    });

    it('当 authorizer 执行抛出异常时应安全捕获并拒绝订阅', async () => {
      manager.register('private:error-prone', () => {
        throw new Error('Database connection failed during check');
      });

      const result = await manager.canSubscribe(user, 'private:error-prone');
      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('Internal authorization error');
    });
  });
});
