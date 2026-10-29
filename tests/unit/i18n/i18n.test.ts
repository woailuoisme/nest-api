import { I18nContext, I18nModule, I18nService } from '@nestjs/i18n';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createI18nModuleConfig } from '@/i18n/i18n.config';

describe('@nestjs/i18n 国际化模块集成测试', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let i18nService: I18nService;
  let i18nContext: I18nContext;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [I18nModule.forRoot(createI18nModuleConfig())],
    }).compile();

    i18nService = moduleRef.get(I18nService);
    i18nContext = moduleRef.get(I18nContext);
  });

  afterAll(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  describe('createI18nModuleConfig 配置', () => {
    it('默认 zh、支持 zh/en、显式 Query/Header 优先且测试环境缺键即抛错', () => {
      const config = createI18nModuleConfig();
      expect(config.defaultLocale).toBe('zh');
      expect(config.supportedLocales).toEqual(['zh', 'en']);
      expect(config.missingKey).toBe('throw');
      expect(config.resolvers).toHaveLength(3);
    });
  });

  describe('基础转译', () => {
    it('默认/显式语言', () => {
      expect(i18nService.t('app.hello')).toBe('你好，世界！');
      expect(i18nService.t('app.hello', { locale: 'en' })).toBe('Hello, World!');
    });

    it('动态参数插值', () => {
      expect(i18nService.t('validation.required', { args: { field: '邮箱' } })).toBe('邮箱 是必填项');
      expect(i18nService.t('validation.required', { locale: 'en', args: { field: 'Email' } })).toBe(
        'Email is required',
      );
    });
  });

  describe('异常与数据库约束键', () => {
    it('中英双语', () => {
      expect(i18nService.t('common.notFound')).toBe('资源不存在');
      expect(i18nService.t('common.notFound', { locale: 'en' })).toBe('Requested resource not found');
      expect(i18nService.t('db.uniqueViolation')).toBe('数据已存在，请勿重复操作');
      expect(i18nService.t('db.foreignKeyViolation', { locale: 'en' })).toBe(
        'Referenced target record does not exist or cannot be linked',
      );
    });
  });

  describe('请求内语言上下文', () => {
    it('I18nContext.run 让无请求代码使用指定语言', () => {
      expect(i18nContext.run('en', () => i18nService.t('auth.loginFailed'))).toBe('Invalid credentials');
      expect(i18nService.t('auth.loginFailed')).toBe('用户名或密码错误');
    });
  });
});
