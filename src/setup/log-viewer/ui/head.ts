/**
 * 页面头部元数据与外部资源引入 (Tailwind CSS CDN + Lucide Icons + Google Fonts)
 */
export function renderHead(): string {
  return `
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NestForge Web Log Viewer</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2358a6ff' stroke-width='2'><path d='M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z'/><path d='M6 6h10'/><path d='M6 10h10'/></svg>" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            fontFamily: {
              sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
              mono: ['"JetBrains Mono"', '"Fira Code"', '"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
            },
          },
        },
      };
      // 防闪烁主题初始化
      (function() {
        const saved = localStorage.getItem('nf_log_viewer_theme');
        const isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (isDark) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      })();
    </script>
    <script defer src="https://cdn.jsdelivr.net/npm/@alpinejs/collapse@3.x.x/dist/cdn.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Roboto+Mono:wght@400;500;600&family=Roboto:ital,wght@0,300;0,400;0,500;0,700;1,400&display=swap" rel="stylesheet">
    <style>
      body { 
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      pre, code, .font-mono, td, th { 
        font-family: 'JetBrains Mono', 'Fira Code', 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-variant-numeric: tabular-nums;
      }
      [x-cloak] { display: none !important; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      html.dark { color-scheme: dark; }
      html:not(.dark) { color-scheme: light; }
      html.dark ::-webkit-scrollbar-track { background: #0d1117; }
      html.dark ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 4px; }
      html.dark ::-webkit-scrollbar-thumb:hover { background: #484f58; }
      html:not(.dark) ::-webkit-scrollbar-track { background: #f1f5f9; }
      html:not(.dark) ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
      html:not(.dark) ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

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

      /* JSON Syntax Highlighting */
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
    </style>
  </head>`;
}
