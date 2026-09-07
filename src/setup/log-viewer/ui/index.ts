import { renderAlpineScript } from './client-script';
import { renderHead } from './head';
import { renderHeader } from './header';
import { renderMainContent } from './main-content';
import { renderSidebar } from './sidebar';

export { renderAlpineScript } from './client-script';
export { renderHead } from './head';
export { renderHeader } from './header';
export { renderFooter, renderLogTable, renderMainContent, renderToolbar } from './main-content';
export { renderSidebar } from './sidebar';

/**
 * 渲染全功能 Web Log Viewer 页面 (Tailwind CSS CDN + Alpine.js + Lucide Icons)
 * 极致复刻 Laravel opcodesio/log-viewer 视觉风格与流畅体验，支持 Dark / Light 双主题即时切换
 */
export function renderLogViewerHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
${renderHead()}
<body class="bg-slate-100 text-slate-800 dark:bg-[#0d1117] dark:text-[#e6edf3] antialiased h-screen flex flex-col overflow-hidden select-none font-sans transition-colors"
      x-data="logViewer()" x-init="init()">
  ${renderHeader()}
  <div class="flex-1 flex overflow-hidden">
    ${renderSidebar()}
    ${renderMainContent()}
  </div>
  ${renderAlpineScript()}
</body>
</html>`;
}
