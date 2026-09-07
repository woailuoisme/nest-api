import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { I18nOptions } from 'nestjs-i18n';
import { AcceptLanguageResolver, HeaderResolver, QueryResolver } from 'nestjs-i18n';
import { I18N, isProductionEnv } from '@/common/constants/app.constants';

const currentDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

/** nestjs-i18n 模块配置 (默认 zh，自动回退) */
export function createI18nModuleConfig(): I18nOptions {
  return {
    fallbackLanguage: I18N.FALLBACK_LANG,
    loaderOptions: {
      path: join(currentDir, 'translations/'),
      watch: !isProductionEnv(),
    },
    resolvers: [
      new QueryResolver([I18N.LANG_QUERY]),
      new AcceptLanguageResolver(),
      new HeaderResolver([I18N.LANG_HEADER]),
    ],
  };
}
