import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Handlebars from 'handlebars';
import { LOG_VIEWER_PATH } from '../constants';
import { renderIcon } from './icons';

export interface LogViewerRenderOptions {
  title?: string;
  basePath?: string;
  cssContent?: string;
  twAnimateCssContent?: string;
  tailwindJsContent?: string;
  alpineJsContent?: string;
}

let isInitialized = false;
let compiledTemplate: HandlebarsTemplateDelegate | null = null;
let defaultTwAnimateCssContent = '';
let defaultTailwindJsContent = '';
let defaultAlpineJsContent = '';

/**
 * 离线核心辅助样式 (滚动条、JSON语法高亮、检索荧光笔、x-cloak)
 */
const DEFAULT_BASE_CSS = `
  pre, code, .font-mono, td, th {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-variant-numeric: tabular-nums;
  }
  [x-cloak] {
    display: none !important;
  }
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  html.dark {
    color-scheme: dark;
  }
  html:not(.dark) {
    color-scheme: light;
  }
  html.dark ::-webkit-scrollbar-track {
    background: #0d1117;
  }
  html.dark ::-webkit-scrollbar-thumb {
    background: #30363d;
    border-radius: 4px;
  }
  html.dark ::-webkit-scrollbar-thumb:hover {
    background: #484f58;
  }
  html:not(.dark) ::-webkit-scrollbar-track {
    background: #f1f5f9;
  }
  html:not(.dark) ::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 4px;
  }
  html:not(.dark) ::-webkit-scrollbar-thumb:hover {
    background: #94a3b8;
  }
  @keyframes pulse-row {
    0% { background-color: rgba(56, 189, 248, 0.28); }
    100% { background-color: transparent; }
  }
  .animate-pulse-row {
    animation: pulse-row 2.5s ease-out;
  }
  mark.search-highlight {
    background-color: #fde047;
    color: #713f12;
    border-radius: 2px;
    padding: 0 2px;
    font-weight: 600;
  }
  html.dark mark.search-highlight {
    background-color: rgba(234, 179, 8, 0.38);
    color: #fef08a;
  }
  .json-key { color: #0969da; font-weight: 600; }
  .json-string { color: #0a3069; }
  .json-number { color: #1a7f37; }
  .json-boolean { color: #cf222e; font-weight: 600; }
  .json-null { color: #6e7781; font-style: italic; }
  html.dark .json-key { color: #79c0ff; font-weight: 600; }
  html.dark .json-string { color: #a5d6ff; }
  html.dark .json-number { color: #7ee787; }
  html.dark .json-boolean { color: #ff7b72; font-weight: 600; }
  html.dark .json-null { color: #8b949e; font-style: italic; }
`;

/**
 * 初始化 Handlebars 引擎、Helper、Partials 及内置离线静态资源
 * 在开发模式下动态重新读取编译以支持实时热更，生产环境使用全局单例缓存保证吞吐
 */
function initHandlebars(): void {
  if (isInitialized && compiledTemplate && process.env.NODE_ENV === 'production') return;

  // 非生产开发环境下优先直接读取 src 源码目录，消除 Nest CLI watch 模式 assets 拷贝滞后；生产环境使用打包相对路径
  const srcUiDir = join(process.cwd(), 'src/setup/log-viewer/ui');
  const baseUiDir =
    process.env.NODE_ENV !== 'production' && existsSync(srcUiDir) ? srcUiDir : (import.meta.dirname ?? process.cwd());

  const templatesDir = join(baseUiDir, 'templates');
  const partialsDir = join(templatesDir, 'partials');
  const assetsDir = join(baseUiDir, 'assets');

  // 1. 注册 Handlebars Helper: icon
  Handlebars.registerHelper('icon', (name: string, options?: Handlebars.HelperOptions) => {
    const cls = (options?.hash?.class as string) ?? 'w-4 h-4';
    const attrs = (options?.hash?.attrs as string) ?? '';
    return new Handlebars.SafeString(renderIcon(name, cls, attrs));
  });

  // 2. 注册 Partials
  const partialFiles: Record<string, string> = {
    head: join(partialsDir, 'head.hbs'),
    header: join(partialsDir, 'header.hbs'),
    sidebar: join(partialsDir, 'sidebar.hbs'),
    mainContent: join(partialsDir, 'mainContent.hbs'),
    clientScript: join(partialsDir, 'clientScript.hbs'),
  };

  for (const [name, filePath] of Object.entries(partialFiles)) {
    if (existsSync(filePath)) {
      const partialContent = readFileSync(filePath, 'utf-8');
      Handlebars.registerPartial(name, partialContent);
    }
  }

  // 3. 读取内置离线压缩静态资源 (显式携带版本号，具备向下兼容回退)
  const twAnimatePath = [join(assetsDir, 'tw-animate-1.4.0.min.css'), join(assetsDir, 'tw-animate.min.css')].find(
    existsSync,
  );
  if (twAnimatePath) {
    defaultTwAnimateCssContent = readFileSync(twAnimatePath, 'utf-8');
  }

  const tailwindPath = [join(assetsDir, 'tailwindcss-4.3.3.min.js'), join(assetsDir, 'tailwindcss.min.js')].find(
    existsSync,
  );
  if (tailwindPath) {
    defaultTailwindJsContent = readFileSync(tailwindPath, 'utf-8');
  }

  const alpinePath = [join(assetsDir, 'alpine-3.17.2.min.js'), join(assetsDir, 'alpine.min.js')].find(existsSync);
  if (alpinePath) {
    defaultAlpineJsContent = readFileSync(alpinePath, 'utf-8');
  }

  // 4. 编译主模板
  const indexPath = join(templatesDir, 'index.hbs');
  if (existsSync(indexPath)) {
    const indexContent = readFileSync(indexPath, 'utf-8');
    compiledTemplate = Handlebars.compile(indexContent);
  }

  isInitialized = true;
}

/**
 * 渲染 Web Log Viewer 完整 HTML 页面
 * 由 Handlebars 模板引擎驱动，纯离线自包含，零外部公网 CDN 依赖
 */
export function renderLogViewerHtml(options?: LogViewerRenderOptions): string {
  initHandlebars();

  if (!compiledTemplate) {
    throw new Error('Log Viewer index.hbs template could not be compiled or was not found.');
  }

  const context = {
    title: options?.title ?? 'NestForge Web Log Viewer',
    basePath: options?.basePath ?? LOG_VIEWER_PATH,
    cssContent: (options?.cssContent ?? '') + DEFAULT_BASE_CSS,
    twAnimateCssContent: options?.twAnimateCssContent ?? defaultTwAnimateCssContent,
    tailwindJsContent: options?.tailwindJsContent ?? defaultTailwindJsContent,
    alpineJsContent: options?.alpineJsContent ?? defaultAlpineJsContent,
  };

  return compiledTemplate(context);
}
