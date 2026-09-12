import { describe, expect, it } from 'vitest';
import { renderIcon } from '@/setup/log-viewer/ui/icons';
import { renderLogViewerHtml } from '@/setup/log-viewer/ui/renderer';

describe('LogViewer Handlebars Renderer (log-viewer/ui/renderer.ts)', () => {
  it('应成功渲染出完整离线自包含 HTML 页面', () => {
    const html = renderLogViewerHtml();

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="zh-CN" class="dark">');
    expect(html).toContain('<title>NestForge Web Log Viewer</title>');
    expect(html).toContain('x-data="logViewer()"');
    expect(html).toContain('x-init="init()"');

    // 验证核心组件挂载
    expect(html).toContain('NestForge');
    expect(html).toContain('日志文件列表');
    expect(html).toContain('全部级别');
    expect(html).toContain('logTableContainer');
  });

  it('生成的 HTML 必须 100% 离线自包含，严禁出现任何外部 CDN 依赖', () => {
    const html = renderLogViewerHtml();

    // 严禁存在外部 CDN
    expect(html).not.toContain('cdn.tailwindcss.com');
    expect(html).not.toContain('unpkg.com');
    expect(html).not.toContain('cdn.jsdelivr.net');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');

    // 必须内联包含样式与 Alpine 脚本
    expect(html).toContain('<style>');
    expect(html).toContain('tailwindcss');
    expect(html).toContain('Alpine.js');
  });

  it('静态资源目录应包含携带精确版本号的文件并已剔除客户端 lucide 冗余以优化传输体积', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const assetsDir = join(process.cwd(), 'src/setup/log-viewer/ui/assets');

    // 验证带精确版本号的静态资源文件存在
    expect(existsSync(join(assetsDir, 'alpine-3.17.2.min.js'))).toBe(true);
    expect(existsSync(join(assetsDir, 'tailwindcss-4.3.3.min.js'))).toBe(true);
    expect(existsSync(join(assetsDir, 'tw-animate-1.4.0.min.css'))).toBe(true);
    // 客户端 lucide 已被完全剔除，由 Node.js 服务端 SVG 内联替代（节约 428KB 传输与 DOM 扫描）
    expect(existsSync(join(assetsDir, 'lucide-1.45.0.min.js'))).toBe(false);
  });

  it('应正确支持 Handlebars icon helper 静态注入 SVG 矢量图标及新增工业级图标', () => {
    const html = renderLogViewerHtml();

    // 验证矢量 SVG 节点静态存在，无需客户端 lucide.createIcons() 动态重排
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(html).toContain('lucide-terminal');
    expect(html).toContain('lucide-search');
    expect(html).toContain('lucide-refresh-cw');
    expect(html).toContain('lucide-keyboard');
    expect(html).toContain('lucide-wrap-text');

    // 验证全键盘生产力交互与快捷键模态框挂载
    expect(html).toContain('showShortcutsModal');
    expect(html).toContain('全键盘快捷键指南');
    expect(html).toContain('copyAsCurl');
    expect(html).toContain('handleKeydown');
    expect(html).toContain('toggleWrap');
  });

  it('应支持自定义 basePath 与 title 渲染选项', () => {
    const html = renderLogViewerHtml({
      title: '生产环境系统监控日志',
      basePath: '/admin/system-logs',
    });

    expect(html).toContain('<title>生产环境系统监控日志</title>');
    expect(html).toContain("const basePath = '/admin/system-logs';");
  });

  it('renderIcon 应能正确处理未注册图标的回退与自定义 class/attrs', () => {
    const terminalSvg = renderIcon('terminal', 'w-6 h-6 custom-class', 'data-test="icon"');
    expect(terminalSvg).toContain('w-6 h-6 custom-class');
    expect(terminalSvg).toContain('lucide-terminal');
    expect(terminalSvg).toContain('data-test="icon"');

    // 未知图标回退
    const fallbackSvg = renderIcon('non-existent-icon', 'w-4 h-4');
    expect(fallbackSvg).toContain('lucide-non-existent-icon');
  });
});
