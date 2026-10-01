import { describe, expect, it } from 'vitest';
import { MailTemplateRenderer } from '@/common/mail/mail-template.renderer';

/**
 * 真实模板渲染测试：直接读取 `src/common/mail/templates` 下的 .hbs 产物，
 * 使「模板变量契约」在移除第三方适配器后依然被强制校验（strict 模式下缺变量即抛错）。
 */
describe('MailTemplateRenderer', () => {
  const renderer = new MailTemplateRenderer();

  it.each([
    ['welcome.zh.hbs', '欢迎'],
    ['welcome.en.hbs', 'Welcome'],
    ['verify-email.zh.hbs', '{{'],
    ['reset-password.en.hbs', '{{'],
  ])('%s 应能按上下文渲染出完整 HTML', async (templateFile) => {
    const html = await renderer.render(templateFile, {
      name: '张三',
      link: 'https://app.example.com/auth/verify-email?token=token-abc',
    });

    expect(html).toContain('张三');
    expect(html).toContain('https://app.example.com/auth/verify-email?token=token-abc');
    // 未渲染的占位符残留说明上下文与模板已漂移
    expect(html).not.toContain('{{name}}');
    expect(html).not.toContain('{{{link}}}');
  });

  it('strict 模式：上下文缺少模板所需变量时应抛错，而非静默渲染为空', async () => {
    await expect(renderer.render('welcome.zh.hbs', { name: '张三' })).rejects.toThrow();
  });

  it('模板文件不存在时应抛错（失败上抛给队列重试，不发送空正文邮件）', async () => {
    await expect(renderer.render('not-exist.zh.hbs', { name: 'x', link: 'y' })).rejects.toThrow();
  });

  it('非法模板文件名（含路径分隔符）应直接拒绝，避免越出模板目录', async () => {
    await expect(renderer.render('../../package.json', {})).rejects.toThrow('非法邮件模板文件名');
  });

  it('重复渲染命中编译缓存且输出稳定', async () => {
    const context = { name: 'Bob', link: 'https://app.example.com/login' };

    const first = await renderer.render('welcome.en.hbs', context);
    const second = await renderer.render('welcome.en.hbs', context);

    expect(second).toBe(first);
  });
});
