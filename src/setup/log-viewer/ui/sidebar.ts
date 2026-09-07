/**
 * 侧边栏日志文件列表组件
 */
export function renderSidebar(): string {
  return `
  <aside class="w-80 border-r border-slate-200 dark:border-[#30363d] bg-slate-50/90 dark:bg-[#010409] flex flex-col shrink-0 transition-colors">
    <!-- 侧边栏标题与搜索 -->
    <div class="p-3.5 border-b border-slate-200 dark:border-[#30363d] space-y-2.5">
      <div class="flex items-center justify-between text-xs text-slate-500 dark:text-[#7d8590]">
        <span class="font-semibold uppercase tracking-wider text-xs text-slate-700 dark:text-[#c9d1d9]">日志文件列表</span>
        <span class="font-mono text-xs" x-text="files.length + ' 个文件'"></span>
      </div>
      <div class="relative">
        <i data-lucide="search" class="w-4 h-4 text-slate-400 dark:text-[#7d8590] absolute left-3 top-3"></i>
        <input type="text" x-model="fileSearch" placeholder="过滤文件名..."
               class="w-full bg-white dark:bg-[#0d1117] text-sm text-slate-900 dark:text-[#e6edf3] placeholder-slate-400 dark:placeholder-[#7d8590] pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-[#30363d] focus:outline-none focus:border-sky-500 focus:dark:border-[#58a6ff] transition">
      </div>
    </div>

    <!-- 文件列表容器 -->
    <div class="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-[#21262d]">
      <template x-for="file in filteredFiles" :key="file.name">
        <div @click="selectFile(file.name)"
             :class="selectedFile === file.name 
               ? 'bg-sky-50 dark:bg-[#161b22] border-l-[3px] border-l-sky-500 dark:border-l-[#1f6feb] text-sky-900 dark:text-[#58a6ff] font-medium' 
               : 'border-l-[3px] border-l-transparent text-slate-700 dark:text-[#c9d1d9] hover:bg-slate-100/70 dark:hover:bg-[#161b22]/70'"
             class="group flex items-center justify-between px-3.5 py-3 transition cursor-pointer text-sm">
          <div class="flex items-center space-x-2 truncate min-w-0 flex-1">
            <span class="truncate font-sans text-sm" x-text="file.name"></span>
          </div>
          
          <div class="flex items-center space-x-2 shrink-0 ml-2">
            <span class="text-[13px] text-slate-400 dark:text-[#7d8590] font-mono" x-text="file.sizeFormatted"></span>
            
            <!-- 文件快捷操作：复制名、下载、清空与删除 -->
            <div class="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition" @click.stop>
              <button @click="copyText(file.name, '已复制文件名: ' + file.name)" title="复制文件名" class="p-1 hover:text-sky-600 dark:hover:text-[#58a6ff] text-slate-400 dark:text-[#7d8590] rounded">
                <i data-lucide="copy" class="w-3.5 h-3.5"></i>
              </button>
              <button @click="downloadFile(file.name)" title="下载原始日志" class="p-1 hover:text-sky-600 dark:hover:text-[#58a6ff] text-slate-400 dark:text-[#7d8590] rounded">
                <i data-lucide="download" class="w-3.5 h-3.5"></i>
              </button>
              <button @click="clearFile(file.name)" title="清空内容" class="p-1 hover:text-amber-500 dark:hover:text-[#d29922] text-slate-400 dark:text-[#7d8590] rounded">
                <i data-lucide="eraser" class="w-3.5 h-3.5"></i>
              </button>
              <button @click="deleteFile(file.name)" title="删除文件" class="p-1 hover:text-rose-500 dark:hover:text-[#f85149] text-slate-400 dark:text-[#7d8590] rounded">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>
        </div>
      </template>

      <div x-show="filteredFiles.length === 0" class="p-6 text-center text-sm text-slate-400 dark:text-[#7d8590] space-y-1">
        <i data-lucide="file-x-2" class="w-8 h-8 mx-auto stroke-1 opacity-60"></i>
        <div>无匹配的日志文件</div>
      </div>
    </div>

    <!-- 侧边栏底部：当前选中文件状态 -->
    <div x-show="fileStats" class="p-3.5 border-t border-slate-200 dark:border-[#30363d] bg-slate-100/60 dark:bg-[#0d1117] text-xs font-mono space-y-1.5 text-slate-500 dark:text-[#7d8590] transition-colors">
      <div class="flex justify-between">
        <span>当前文件:</span>
        <span class="text-slate-800 dark:text-[#e6edf3] font-semibold truncate max-w-[160px]" x-text="fileStats?.name"></span>
      </div>
      <div class="flex justify-between">
        <span>文件大小:</span>
        <span class="text-slate-800 dark:text-[#e6edf3]" x-text="fileStats?.sizeFormatted"></span>
      </div>
    </div>
  </aside>`;
}
