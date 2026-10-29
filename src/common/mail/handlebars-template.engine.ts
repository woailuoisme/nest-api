import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MailTemplateEngine,
  MailTemplateError,
  type MailTemplateOutput,
  type MailTemplateRenderOptions,
} from '@nestjs/mail';
import Handlebars from 'handlebars';

const currentDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

/** 模板目录：构建期由 nest-cli.json assets 拷贝至产物 */
const TEMPLATES_DIR = join(currentDir, 'templates');

type CompiledTemplate = ReturnType<typeof Handlebars.compile>;

/**
 * 官方 `MailTemplateEngine` 的 Handlebars 实现。
 *
 * 继续使用现有 MJML → `.hbs` 构建链（`name.{zh,en}.hbs`），按 locale 选择模板，
 * 保留 `strict: true`：缺失上下文即失败，而不是静默渲染空串。
 */
export class HandlebarsTemplateEngine extends MailTemplateEngine {
  private readonly templates = new Map<string, CompiledTemplate | undefined>();

  constructor(private readonly defaultLocale: string = 'zh') {
    super();
  }

  async render(name: string, context: object, { locale }: MailTemplateRenderOptions): Promise<MailTemplateOutput> {
    // 只允许语言码进入文件名；最终回退到项目默认语言（模板均为 {name}.{locale}.hbs）
    const candidates =
      locale && /^[a-z]{2}$/.test(locale)
        ? [`${name}.${locale}.hbs`, `${name}.hbs`, `${name}.${this.defaultLocale}.hbs`]
        : [`${name}.hbs`, `${name}.${this.defaultLocale}.hbs`];
    for (const file of [...new Set(candidates)]) {
      const template = await this.load(file);
      if (template) {
        return template(context);
      }
    }
    throw new MailTemplateError(`No mail template "${name}" in ${TEMPLATES_DIR}`, { template: name });
  }

  private async load(file: string): Promise<CompiledTemplate | undefined> {
    if (!this.templates.has(file)) {
      const source = await readFile(join(TEMPLATES_DIR, file), 'utf8').catch(() => undefined);
      this.templates.set(file, source === undefined ? undefined : Handlebars.compile(source, { strict: true }));
    }
    return this.templates.get(file);
  }
}
