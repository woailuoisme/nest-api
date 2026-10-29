import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AcceptLanguageLocaleResolver,
  HeaderLocaleResolver,
  type I18nForRootOptions,
  JsonI18nLoader,
  QueryLocaleResolver,
} from '@nestjs/i18n';

import { I18N, isProductionEnv } from '@/common/constants/app.constants';

const currentDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

/** 官方 `@nestjs/i18n` 配置：zh 默认，显式 `?lang` / `x-lang` 优先于 Accept-Language */
export function createI18nModuleConfig(): I18nForRootOptions {
  const production = isProductionEnv();

  return {
    defaultLocale: I18N.FALLBACK_LANG,
    supportedLocales: ['zh', 'en'],
    loader: new JsonI18nLoader({
      path: join(currentDir, 'translations'),
      watch: !production,
    }),
    resolvers: [
      new QueryLocaleResolver(I18N.LANG_QUERY),
      new HeaderLocaleResolver(I18N.LANG_HEADER),
      new AcceptLanguageLocaleResolver(),
    ],
    // 非生产（含测试/CI）缺键直接失败；生产回退默认语言并告警
    missingKey: production ? 'fallback' : 'throw',
    logMissingKeys: 'once',
  };
}
