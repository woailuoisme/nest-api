/**
 * 顶部导航栏组件
 */
export function renderHeader(): string {
  return `
  <header class="h-16 border-b border-slate-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] px-6 flex items-center justify-between shrink-0 z-20 transition-colors">
    <div class="flex items-center space-x-3">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 dark:from-[#1f6feb] dark:to-[#8957e5] flex items-center justify-center shadow-lg shadow-sky-500/20 dark:shadow-[#1f6feb]/20">
        <i data-lucide="terminal" class="w-5 h-5 text-white stroke-[2.5]"></i>
      </div>
      <span class="font-bold text-slate-900 dark:text-[#f0f6fc] text-lg tracking-tight">NestForge</span>
    </div>

    <!-- 中间：SSE 重连中警告条 -->
    <div x-show="liveStreamActive && sseStatus === 'reconnecting'" x-cloak
         class="flex items-center space-x-2 px-3.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-[#d29922] text-xs font-semibold animate-pulse">
      <i data-lucide="alert-triangle" class="w-4 h-4"></i>
      <span>SSE 实时流断线，正在尝试自动重新连接...</span>
    </div>

    <!-- 顶部状态栏与操作按钮 -->
    <div class="flex items-center space-x-3 text-sm">
      <div class="hidden sm:flex items-center space-x-2 text-slate-600 dark:text-[#7d8590] bg-slate-100 dark:bg-[#21262d] px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#30363d] font-medium">
        <i data-lucide="activity" class="w-4 h-4 text-emerald-500 dark:text-[#3fb950]"></i>
        <span>性能消耗:</span>
        <span class="font-mono text-emerald-600 dark:text-[#3fb950] font-semibold text-sm" x-text="statsText"></span>
      </div>

      <!-- 刷新按钮 -->
      <button @click="fetchEntries(false)" 
              class="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 dark:bg-[#238636] dark:hover:bg-[#2ea043] dark:border dark:border-[#2ea043]/40 text-slate-950 dark:text-white font-semibold text-sm transition shadow-sm"
              :class="{'opacity-75 cursor-not-allowed': loading}">
        <i data-lucide="refresh-cw" class="w-4 h-4" :class="{'animate-spin': loading}"></i>
        <span>刷新</span>
      </button>

      <!-- 主题切换按钮 (Dark / Light) -->
      <button @click="toggleTheme()" 
              class="flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 dark:border-[#30363d] bg-slate-100 hover:bg-slate-200 dark:bg-[#21262d] dark:hover:bg-[#30363d] text-slate-600 dark:text-[#c9d1d9] transition shadow-sm"
              :title="theme === 'dark' ? '切换为浅色主题 (Light)' : '切换为深色主题 (Dark)'">
        <template x-if="theme === 'dark'">
          <i data-lucide="sun" class="w-4 h-4 text-[#e3b341]"></i>
        </template>
        <template x-if="theme === 'light'">
          <i data-lucide="moon" class="w-4 h-4 text-slate-700"></i>
        </template>
      </button>
    </div>
  </header>`;
}
