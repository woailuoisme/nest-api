import { Test } from '@nestjs/testing';
import { I18nModule, I18nService } from 'nestjs-i18n';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createI18nModuleConfig } from '@/i18n/i18n.config';
import type { I18nPath, I18nTranslations } from '@/i18n/i18n.generated';

describe('i18n 国际化模块集成测试', () => {
  let moduleRef: any;
  let i18nService: I18nService<I18nTranslations>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [I18nModule.forRoot(createI18nModuleConfig())],
    }).compile();

    i18nService = moduleRef.get(I18nService);
  });

  afterAll(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  describe('createI18nModuleConfig 配置', () => {
    it('应包含正确的默认回退语言及解析器链', () => {
      const config = createI18nModuleConfig();
      expect(config.fallbackLanguage).toBe('zh');
      expect(config.loaderOptions.path).toContain('translations');
      expect(config.resolvers).toBeDefined();
      expect(config.resolvers?.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('基础文本与问候语转译', () => {
    it('应正确转译默认中文语言下的文本', async () => {
      const text = await i18nService.t('translation.app.hello', { lang: 'zh' });
      expect(text).toBe('你好，世界！');
    });

    it('应正确转译英文语言下的文本', async () => {
      const text = await i18nService.t('translation.app.hello', { lang: 'en' });
      expect(text).toBe('Hello, World!');
    });
  });

  describe('动态参数插值', () => {
    it('应正确替换中文模板中的参数插值', async () => {
      const text = await i18nService.t('translation.validation.required', {
        lang: 'zh',
        args: { field: '邮箱' },
      });
      expect(text).toBe('邮箱 是必填项');
    });

    it('应正确替换英文模板中的参数插值', async () => {
      const text = await i18nService.t('translation.validation.required', {
        lang: 'en',
        args: { field: 'Email' },
      });
      expect(text).toBe('Email is required');
    });
  });

  describe('通用异常与数据库约束键转译', () => {
    it('应正确转译通用异常提示（中英双语）', async () => {
      const zhNotFound = await i18nService.t('translation.common.notFound', { lang: 'zh' });
      const enNotFound = await i18nService.t('translation.common.notFound', { lang: 'en' });

      expect(zhNotFound).toBe('资源不存在');
      expect(enNotFound).toBe('Requested resource not found');
    });

    it('应正确转译数据库唯一索引冲突错误（中英双语）', async () => {
      const zhUnique = await i18nService.t('translation.db.uniqueViolation', { lang: 'zh' });
      const enUnique = await i18nService.t('translation.db.uniqueViolation', { lang: 'en' });

      expect(zhUnique).toBe('数据已存在，请勿重复操作');
      expect(enUnique).toBe('Data already exists, please do not duplicate operation');
    });

    it('应正确转译数据库外键与必填约束错误', async () => {
      const zhFk = await i18nService.t('translation.db.foreignKeyViolation', { lang: 'zh' });
      const enFk = await i18nService.t('translation.db.foreignKeyViolation', { lang: 'en' });

      expect(zhFk).toBe('关联引用的目标数据不存在或无法关联');
      expect(enFk).toBe('Referenced target record does not exist or cannot be linked');
    });
  });
});
