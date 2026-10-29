import { describe, expect, it } from 'vitest';

import { AdminPolicy } from '@/common/authorization/policies/admin.policy';
import { IotPolicy } from '@/common/authorization/policies/iot.policy';
import { UserPolicy } from '@/common/authorization/policies/user.policy';
import { Role } from '@/common/constants/roles';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

const as = (role: Role, id = 'user-1'): CurrentUserPayload => ({ id, email: `${id}@example.com`, role });

describe('AdminPolicy', () => {
  const policy = new AdminPolicy();

  it('SUPER_ADMIN 通过 before() 直通所有能力', () => {
    const superAdmin = as(Role.SUPER_ADMIN);
    expect(policy.before(superAdmin)).toBe(true);
  });

  it('ADMIN 可创建/删除用户与变更角色，OPERATOR 不可', () => {
    const admin = as(Role.ADMIN);
    const operator = as(Role.OPERATOR);
    expect(policy.createUser(admin)).toBe(true);
    expect(policy.deleteUser(admin)).toBe(true);
    expect(policy.changeUserRole(admin)).toBe(true);
    expect(policy.createUser(operator)).toBe(false);
    expect(policy.deleteUser(operator)).toBe(false);
    expect(policy.changeUserRole(operator)).toBe(false);
  });

  it('OPERATOR 可读用户、更新用户、看仪表盘与发通知', () => {
    const operator = as(Role.OPERATOR);
    expect(policy.listUsers(operator)).toBe(true);
    expect(policy.updateUser(operator)).toBe(true);
    expect(policy.viewDashboard(operator)).toBe(true);
    expect(policy.sendNotification(operator)).toBe(true);
  });

  it('普通用户与访客一律拒绝', () => {
    for (const user of [as(Role.USER), null]) {
      expect(policy.listUsers(user)).toBe(false);
      expect(policy.viewDashboard(user)).toBe(false);
    }
  });
});

describe('UserPolicy', () => {
  const policy = new UserPolicy();

  it('本人可读，他人不可读；OPERATOR 可读他人', () => {
    expect(policy.view(as(Role.USER, 'me'), 'me')).toBe(true);
    expect(policy.view(as(Role.USER, 'me'), 'other')).toBe(false);
    expect(policy.view(as(Role.OPERATOR, 'op'), 'other')).toBe(true);
    expect(policy.view(null, 'other')).toBe(false);
  });

  it('ADMIN / SUPER_ADMIN 通过 before() 直通', () => {
    expect(policy.before(as(Role.ADMIN))).toBe(true);
    expect(policy.before(as(Role.SUPER_ADMIN))).toBe(true);
    expect(policy.before(as(Role.OPERATOR))).toBeUndefined();
  });
});

describe('IotPolicy', () => {
  const policy = new IotPolicy();

  it('仅 OPERATOR / ADMIN / SUPER_ADMIN 可访问设备', () => {
    expect(policy.accessDevices(as(Role.OPERATOR))).toBe(true);
    expect(policy.accessDevices(as(Role.ADMIN))).toBe(true);
    expect(policy.accessDevices(as(Role.USER))).toBe(false);
    expect(policy.accessDevices(null)).toBe(false);
    expect(policy.before(as(Role.SUPER_ADMIN))).toBe(true);
  });
});
