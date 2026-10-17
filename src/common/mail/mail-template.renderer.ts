import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';

const currentDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

/** 模板目录：构建期由 nest-cli.json 的 assets 规则（`common/mail/templates/*.hbs`）拷贝至产物，运行期只读 */
const TEMPLATES_DIR = join(currentDir, 'templates');

/**
 * 邮件模板渲染器 (MailTemplateRenderer)
 *
 * 以 Handlebars 直接编译模板文件（不再经由第三方适配器），并保持 `strict: true`：
 * 缺失变量会立即抛错而非静默渲染为空串，使模板与调用方的上下文契约在测试与运行时都被强制校验。
 * 模板为构建期产物、运行期不变，故编译结果按文件名缓存，避免每次发信重复读盘与编译。
 */
@Injectable()
export class MailTemplateRenderer {
  private readonly cache = new Map<string, Handlebars.TemplateDelegate>();

  /**
   * 渲染模板
   *
   * @param templateFile 相对 templates 目录的文件名（如 `welcome.zh.hbs`）
   * @param context 模板上下文
   */
  async render(templateFile: string, context: Record<string, unknown>): Promise<string> {
    const compiled = await this.compile(templateFile);
    return compiled(context);
  }

  /** 编译并缓存模板（文件名含路径分隔符时直接拒绝，避免越出模板目录读取任意文件） */
  private async compile(templateFile: string): Promise<Handlebars.TemplateDelegate> {
    if (templateFile.includes('/') || templateFile.includes('\\')) {
      throw new Error(`非法邮件模板文件名: ${templateFile}`);
    }

    const cached = this.cache.get(templateFile);
    if (cached) {
      return cached;
    }

    const source = await readFile(join(TEMPLATES_DIR, templateFile), 'utf8');
    const compiled = Handlebars.compile(source, { strict: true });
    this.cache.set(templateFile, compiled);
    return compiled;
  }
}
