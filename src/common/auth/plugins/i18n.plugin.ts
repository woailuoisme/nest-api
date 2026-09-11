import { i18n, locales } from '@better-auth/i18n';

/**
 * 国际化多语言插件集：自动翻译认证框架返回的错误与提示信息
 * 支持通过 Header (Accept-Language)、Cookie (locale) 及 Session (user.locale) 自动嗅探语言
 */
export const i18nPlugins = [
  i18n({
    defaultLocale: 'zh',
    translations: {
      zh: locales.zh,
      'zh-CN': locales.zh,
      en: locales.en,
      ja: locales.ja,
    },
    detection: ['header', 'cookie', 'session'],
    localeCookie: 'locale',
  }),
];
