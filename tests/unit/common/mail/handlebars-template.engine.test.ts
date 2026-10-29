import { describe, expect, it, vi } from 'vitest';

import { HandlebarsTemplateEngine } from '@/common/mail/handlebars-template.engine';

describe('HandlebarsTemplateEngine', () => {
  const engine = new HandlebarsTemplateEngine();

  it('按 locale 选择模板并渲染上下文', async () => {
    const html = await engine.render(
      'verify-email',
      { name: '张三', link: 'https://example.com/v?t=1' },
      { locale: 'zh' },
    );
    expect(html).toContain('张三');
    expect(html).toContain('https://example.com/v?t=1');
  });

  it('未知 locale 回退到默认模板', async () => {
    const html = await engine.render(
      'verify-email',
      { name: 'Ada', link: 'https://example.com/v?t=1' },
      { locale: 'fr' },
    );
    expect(html).toContain('Ada');
  });

  it('缺失模板抛出永久 MailTemplateError', async () => {
    await expect(engine.render('missing-template', {}, { locale: 'zh' })).rejects.toMatchObject({
      name: 'MailTemplateError',
      permanent: true,
    });
  });

  it('strict 模式下缺失上下文变量会失败', async () => {
    await expect(engine.render('verify-email', {}, { locale: 'zh' })).rejects.toThrow();
  });
});
