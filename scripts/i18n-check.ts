import { join } from 'node:path';

import { type I18nCatalog, JsonI18nLoader } from '@nestjs/i18n';

type Message = string | Record<string, string>;

/** 展平 catalog：plural 对象视为一个消息 */
function messages(tree: I18nCatalog, prefix = ''): [string, Message][] {
  return Object.entries(tree).flatMap(([name, value]): [string, Message][] => {
    if (typeof value === 'string') {
      return [[prefix + name, value]];
    }
    if (typeof value === 'object' && value !== null && 'other' in value) {
      return [[prefix + name, value as Record<string, string>]];
    }
    return messages(value as I18nCatalog, `${prefix}${name}.`);
  });
}

const placeholders = (message: Message) =>
  [...new Set(JSON.stringify(message).match(/\{\w+\}/g) ?? [])].sort();

const loader = new JsonI18nLoader({ path: join(import.meta.dirname, '../src/i18n/translations') });
const catalogs = (await loader.load()) as Record<string, I18nCatalog>;

const source = new Map(messages(catalogs.en ?? {}));
const problems: string[] = [];

for (const [locale, catalog] of Object.entries(catalogs)) {
  const translated = new Map(messages(catalog));
  const missing = [...source.keys()].filter((key) => !translated.has(key));
  const extra = [...translated.keys()].filter((key) => !source.has(key));
  if (missing.length > 0) problems.push(`${locale}: missing keys -> ${missing.join(', ')}`);
  if (extra.length > 0) problems.push(`${locale}: unknown keys -> ${extra.join(', ')}`);

  for (const [key, message] of translated) {
    const expected = source.get(key);
    if (expected === undefined) continue;
    const actualPlaceholders = placeholders(message);
    const expectedPlaceholders = placeholders(expected);
    if (actualPlaceholders.join('|') !== expectedPlaceholders.join('|')) {
      problems.push(
        `${locale}: ${key} placeholders ${actualPlaceholders.join(',')} != ${expectedPlaceholders.join(',')}`,
      );
    }
  }

  const requiredForms = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  for (const [key, message] of translated) {
    if (typeof message === 'object') {
      const missingForms = requiredForms.filter((form) => !(form in message));
      if (missingForms.length > 0) {
        problems.push(`${locale}: ${key} missing plural forms -> ${missingForms.join(', ')}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`❌ i18n catalog check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`✅ i18n catalogs OK: ${Object.keys(catalogs).sort().join(', ')}`);
}
