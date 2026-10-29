import type { I18nKey } from '@nestjs/i18n';

import type app from './translations/en/app.json';
import type auth from './translations/en/auth.json';
import type common from './translations/en/common.json';
import type db from './translations/en/db.json';
import type validation from './translations/en/validation.json';

/** 英文目录是类型事实源；`declare module` 让 `t()` / `i18nIssueMessage()` 只接受存在的键 */
export interface Translations {
  app: typeof app;
  auth: typeof auth;
  common: typeof common;
  db: typeof db;
  validation: typeof validation;
}

declare module '@nestjs/i18n' {
  interface I18nTypes {
    translations: Translations;
  }
}

/** 全局翻译键类型（供异常过滤器等非 DI 代码使用） */
export type I18nPath = I18nKey<Translations>;
