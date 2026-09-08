import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Handlebars from 'handlebars';
import type { EnvConfig } from '@/config/env.validation';
import type { MailLocale, MailTemplateName } from './mail.jobs';

const currentDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

interface MailRenderContext {
  name: string;
  link: string;
}

/**
 * 邮件模板渲染服务 — 编译期由 MJML 生成的 .hbs 模板 + 运行时 Handlebars 插值。
 * 根据语言选择对应模板，链接由 APP_URL + token 拼装，模板只含 {{name}} / {{link}} 占位符。
 */
@Injectable()
export class MailTemplateService {
  private readonly appUrl: string;
  private readonly cache = new Map<string, Handlebars.TemplateDelegate<MailRenderContext>>();

  constructor(config: ConfigService<EnvConfig, true>) {
    this.appUrl = config.get('APP_URL');
  }

  /** 渲染指定模板与语言的邮件正文 HTML */
  render(name: MailTemplateName, locale: MailLocale, ctx: { name: string; token?: string }): string {
    const template = this.getTemplate(name, locale);
    return template({ name: ctx.name, link: this.buildLink(name, ctx.token) });
  }

  /** 拼装邮件内链接 — welcome 指向登录页（无 token），verify/reset 携带 token */
  private buildLink(name: MailTemplateName, token?: string): string {
    if (name === 'welcome') {
      return `${this.appUrl}/login`;
    }
    const path = name === 'verify-email' ? '/auth/verify-email' : '/auth/reset-password';
    return `${this.appUrl}${path}?token=${token}`;
  }

  /** 加载并缓存编译后的 Handlebars 模板 */
  private getTemplate(name: MailTemplateName, locale: MailLocale): Handlebars.TemplateDelegate<MailRenderContext> {
    const key = `${name}.${locale}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const file = join(currentDir, 'templates', `${name}.${locale}.hbs`);
    const compiled = Handlebars.compile<MailRenderContext>(readFileSync(file, 'utf-8'));
    this.cache.set(key, compiled);
    return compiled;
  }
}
