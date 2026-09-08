import { describe, expect, it } from 'vitest';
import { auth } from '@/common/auth/better-auth';
import { passkey, passkeyRelations, user, userRelations } from '@/database/drizzle/schema';

describe('Better Auth 新增插件集成 (Passkey, One Tap, Anonymous)', () => {
  it('应成功装配 passkey, one-tap, anonymous 插件到 Better Auth 实例', () => {
    const plugins = auth.options.plugins || [];
    const pluginIds = plugins.map((p) => p.id);

    expect(pluginIds).toContain('passkey');
    expect(pluginIds).toContain('one-tap');
    expect(pluginIds).toContain('anonymous');
  });

  it('Passkey 插件应包含标准安全配置与 7 个核心端点', () => {
    const passkeyPlugin = (auth.options.plugins || []).find((p) => p.id === 'passkey');
    expect(passkeyPlugin).toBeDefined();

    const options = (passkeyPlugin as Record<string, any>).options;
    expect(options.rpName).toBe('NestForge');
    expect(options.rpID).toBeDefined();
    expect(options.origin).toBeDefined();
    expect(options.registration?.requireSession).toBe(true);

    const endpoints = Object.keys(passkeyPlugin?.endpoints || {});
    expect(endpoints).toContain('generatePasskeyRegistrationOptions');
    expect(endpoints).toContain('generatePasskeyAuthenticationOptions');
    expect(endpoints).toContain('verifyPasskeyRegistration');
    expect(endpoints).toContain('verifyPasskeyAuthentication');
    expect(endpoints).toContain('listPasskeys');
    expect(endpoints).toContain('deletePasskey');
    expect(endpoints).toContain('updatePasskey');
  });

  it('One Tap 插件应复用 Google 客户端凭据并允许免密快捷注册', () => {
    const oneTapPlugin = (auth.options.plugins || []).find((p) => p.id === 'one-tap');
    expect(oneTapPlugin).toBeDefined();

    const options = (oneTapPlugin as Record<string, any>).options;
    expect(options.disableSignup).toBe(false);
    expect(options.clientId).toBeDefined();

    const endpoints = Object.keys(oneTapPlugin?.endpoints || {});
    expect(endpoints).toContain('oneTapCallback');
  });

  it('Anonymous 插件应包含标准 RFC 2606 占位域名且允许转正后清理', () => {
    const anonPlugin = (auth.options.plugins || []).find((p) => p.id === 'anonymous');
    expect(anonPlugin).toBeDefined();

    const options = (anonPlugin as Record<string, any>).options;
    expect(options.emailDomainName).toBe('anonymous.placeholder.invalid');
    expect(options.disableDeleteAnonymousUser).toBe(false);

    const endpoints = Object.keys(anonPlugin?.endpoints || {});
    expect(endpoints).toContain('signInAnonymous');
    expect(endpoints).toContain('deleteAnonymousUser');
  });

  it('Drizzle Schema 应正确声明 user.isAnonymous 与 passkey 表结构与关系', () => {
    // 1. user.isAnonymous
    expect(user.isAnonymous).toBeDefined();
    expect(user.isAnonymous.name).toBe('is_anonymous');

    // 2. passkey table columns
    expect(passkey.id).toBeDefined();
    expect(passkey.name).toBeDefined();
    expect(passkey.publicKey).toBeDefined();
    expect(passkey.userId).toBeDefined();
    expect(passkey.credentialID).toBeDefined();
    expect(passkey.counter).toBeDefined();
    expect(passkey.deviceType).toBeDefined();
    expect(passkey.backedUp).toBeDefined();
    expect(passkey.transports).toBeDefined();
    expect(passkey.createdAt).toBeDefined();
    expect(passkey.aaguid).toBeDefined();

    // 3. relations
    expect(userRelations).toBeDefined();
    expect(passkeyRelations).toBeDefined();
  });
});
