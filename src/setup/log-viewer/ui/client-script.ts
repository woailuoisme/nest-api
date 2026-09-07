import { LOG_VIEWER_PATH } from '../constants';

/**
 * Alpine.js 客户端驱动脚本
 */
export function renderAlpineScript(): string {
  return `
  <script>
    function logViewer() {
      return {
        theme: localStorage.getItem('nf_log_viewer_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
        files: [],
        fileSearch: '',
        selectedFile: '',
        loading: false,
        items: [],
        meta: { total: 0, page: 1, perPage: 25, totalPages: 1, countByLevel: {} },
        fileStats: null,
        performance: { durationMs: 0, memory: '0 MB' },
        
        // 过滤器状态
        selectedLevels: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
        searchKeyword: '',
        direction: 'desc',
        perPage: 25,
        pollingInterval: 0,
        pollingTimer: null,

        // 实时流 SSE 状态
        liveStreamActive: false,
        sseStatus: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
        eventSource: null,
        autoScrollLive: true,

        // 展开与 Tab 状态
        expandedRows: {},
        rowTabs: {},

        // 弹窗与 Toast 状态
        toasts: [],
        confirmModal: {
          show: false,
          title: '',
          message: '',
          confirmText: '确认',
          cancelText: '取消',
          isDestructive: true,
          onConfirm: null,
        },

        availableLevels: [
          { name: 'fatal', label: 'Fatal', shortLabel: 'FATAL', textColor: 'text-rose-500 dark:text-[#ff7b72]', bgClass: 'bg-rose-500/10 dark:bg-[#f85149]/15 border-rose-500/30 text-rose-600 dark:text-[#ff7b72]' },
          { name: 'error', label: 'Error', shortLabel: 'ERROR', textColor: 'text-red-500 dark:text-[#ff7b72]', bgClass: 'bg-red-500/10 dark:bg-[#f85149]/15 border-red-500/30 text-red-600 dark:text-[#ff7b72]' },
          { name: 'warn', label: 'Warn', shortLabel: 'WARN', textColor: 'text-amber-500 dark:text-[#d29922]', bgClass: 'bg-amber-500/10 dark:bg-[#d29922]/15 border-amber-500/30 text-amber-600 dark:text-[#d29922]' },
          { name: 'info', label: 'Info', shortLabel: 'INFO', textColor: 'text-sky-500 dark:text-[#58a6ff]', bgClass: 'bg-sky-500/10 dark:bg-[#388bfd]/15 border-sky-500/30 text-sky-600 dark:text-[#58a6ff]' },
          { name: 'debug', label: 'Debug', shortLabel: 'DEBUG', textColor: 'text-purple-500 dark:text-[#d2a8ff]', bgClass: 'bg-purple-500/10 dark:bg-[#a371f7]/15 border-purple-500/30 text-purple-600 dark:text-[#d2a8ff]' },
          { name: 'trace', label: 'Trace', shortLabel: 'TRACE', textColor: 'text-slate-500 dark:text-[#7d8590]', bgClass: 'bg-slate-500/10 dark:bg-[#6e7681]/15 border-slate-500/30 text-slate-600 dark:text-[#7d8590]' },
        ],

        async init() {
          await this.fetchFiles();
          this.$watch('selectedFile', () => {
            if (this.liveStreamActive) {
              this.startLiveStream();
            }
            this.fetchEntries(false);
          });
          this.$nextTick(() => lucide.createIcons());
        },

        showToast(message, type = 'info', duration = 3000) {
          const id = Date.now() + Math.random().toString(36).slice(2, 6);
          this.toasts.push({ id, message, type });
          this.$nextTick(() => lucide.createIcons());
          setTimeout(() => {
            this.removeToast(id);
          }, duration);
        },

        removeToast(id) {
          this.toasts = this.toasts.filter((t) => t.id !== id);
        },

        openConfirm(options) {
          this.confirmModal = {
            show: true,
            title: options.title || '确认操作',
            message: options.message || '确定执行此操作吗？',
            confirmText: options.confirmText || '确定',
            cancelText: options.cancelText || '取消',
            isDestructive: options.isDestructive !== false,
            onConfirm: options.onConfirm || null,
          };
          this.$nextTick(() => lucide.createIcons());
        },

        closeConfirm() {
          this.confirmModal.show = false;
          this.confirmModal.onConfirm = null;
        },

        async executeConfirm() {
          if (typeof this.confirmModal.onConfirm === 'function') {
            const callback = this.confirmModal.onConfirm;
            this.closeConfirm();
            await callback();
          } else {
            this.closeConfirm();
          }
        },

        toggleTheme() {
          this.theme = this.theme === 'dark' ? 'light' : 'dark';
          localStorage.setItem('nf_log_viewer_theme', this.theme);
          if (this.theme === 'dark') {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
          this.$nextTick(() => lucide.createIcons());
        },

        get filteredFiles() {
          if (!this.fileSearch) return this.files;
          return this.files.filter(f => f.name.toLowerCase().includes(this.fileSearch.toLowerCase()));
        },

        get selectedLevelsSummary() {
          const count = this.selectedLevels.length;
          if (count === this.availableLevels.length) return '全部级别 (' + this.meta.total + ')';
          if (count === 0) return '未选级别 (0)';
          return count + ' 个级别 (' + this.meta.total + ')';
        },

        get statsText() {
          if (!this.performance.durationMs) return '';
          return this.performance.memory + ' · ' + this.performance.durationMs + 'ms';
        },

        get showingRange() {
          if (this.meta.total === 0) return '0';
          const start = (this.meta.page - 1) * this.perPage + 1;
          const end = Math.min(this.meta.page * this.perPage, this.meta.total);
          return start + ' - ' + end;
        },

        async fetchFiles() {
          try {
            const res = await fetch('${LOG_VIEWER_PATH}/api/files');
            const data = await res.json();
            this.files = data.files || [];
            if (this.files.length > 0 && !this.selectedFile) {
              this.selectedFile = this.files[0].name;
            }
          } catch (e) {
            this.showToast('获取日志文件列表失败: ' + e.message, 'error');
          }
        },

        onFilterChange() {
          this.meta.page = 1;
          if (this.liveStreamActive) {
            this.startLiveStream();
          }
          this.fetchEntries(false);
        },

        async fetchEntries(silent = false) {
          if (!this.selectedFile) return;
          if (!silent) this.loading = true;

          try {
            const params = new URLSearchParams({
              file: this.selectedFile,
              page: this.meta.page,
              perPage: this.perPage,
              direction: this.direction,
              levels: this.selectedLevels.join(','),
              search: this.searchKeyword || ''
            });

            const res = await fetch('${LOG_VIEWER_PATH}/api/entries?' + params.toString());
            const data = await res.json();
            
            this.items = data.items || [];
            this.meta = data.meta || this.meta;
            this.fileStats = data.fileStats;
            this.performance = data.performance || this.performance;
          } catch (e) {
            this.showToast('查询日志条目失败: ' + e.message, 'error');
          } finally {
            this.loading = false;
            this.$nextTick(() => lucide.createIcons());
          }
        },

        toggleLiveStream() {
          if (this.liveStreamActive) {
            this.stopLiveStream();
            this.showToast('已关闭实时监听', 'info');
          } else {
            this.startLiveStream();
            this.showToast('已开启 SSE 实时监听 (Live)', 'success');
          }
        },

        startLiveStream() {
          if (!this.selectedFile) return;
          this.stopLiveStream();
          this.liveStreamActive = true;
          this.sseStatus = 'connecting';

          const params = new URLSearchParams({
            file: this.selectedFile,
            levels: this.selectedLevels.join(','),
            search: this.searchKeyword || '',
          });

          try {
            this.eventSource = new EventSource('${LOG_VIEWER_PATH}/api/stream?' + params.toString());

            this.eventSource.onopen = () => {
              this.sseStatus = 'connected';
            };

            this.eventSource.addEventListener('log', (e) => {
              try {
                const entry = JSON.parse(e.data);
                if (!this.items.some(it => it.id === entry.id)) {
                  entry.isNew = true;
                  setTimeout(() => { entry.isNew = false; }, 2500);

                  this.items.unshift(entry);
                  if (this.items.length > this.perPage * 2) {
                    this.items.pop();
                  }
                  this.meta.total++;
                  if (this.meta.countByLevel[entry.level] !== undefined) {
                    this.meta.countByLevel[entry.level]++;
                  }

                  if (this.autoScrollLive) {
                    const tableContainer = document.getElementById('logTableContainer');
                    if (tableContainer && tableContainer.scrollTop < 100) {
                      tableContainer.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }

                  this.$nextTick(() => lucide.createIcons());
                }
              } catch (err) {
                console.error('Failed to parse log stream event:', err);
              }
            });

            this.eventSource.onerror = () => {
              if (this.liveStreamActive) {
                this.sseStatus = 'reconnecting';
              }
            };
          } catch (err) {
            this.showToast('启动实时流失败: ' + err.message, 'error');
            this.liveStreamActive = false;
            this.sseStatus = 'disconnected';
          }
        },

        stopLiveStream() {
          if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
          }
          this.liveStreamActive = false;
          this.sseStatus = 'disconnected';
        },

        selectFile(filename) {
          this.selectedFile = filename;
          this.meta.page = 1;
          this.fetchEntries(false);
        },

        toggleLevel(lvlName) {
          if (this.selectedLevels.includes(lvlName)) {
            this.selectedLevels = this.selectedLevels.filter(l => l !== lvlName);
          } else {
            this.selectedLevels.push(lvlName);
          }
          this.onFilterChange();
        },

        toggleSingleLevel(lvlName) {
          if (this.selectedLevels.length === 1 && this.selectedLevels[0] === lvlName) {
            this.selectedLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
          } else {
            this.selectedLevels = [lvlName];
          }
          this.onFilterChange();
        },

        selectAllLevels() {
          this.selectedLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
          this.onFilterChange();
        },

        deselectAllLevels() {
          this.selectedLevels = [];
          this.onFilterChange();
        },

        // 链路与上下文过滤助手：设置搜索关键词、刷新并给出反馈
        filterBy(value, message) {
          if (value == null || value === '') return;
          this.searchKeyword = String(value);
          this.onFilterChange();
          this.showToast(message, 'info');
        },

        goToPage(p) {
          if (p < 1 || p > this.meta.totalPages) return;
          this.meta.page = p;
          this.fetchEntries(false);
        },

        toggleRow(id) {
          this.expandedRows[id] = !this.expandedRows[id];
          if (!this.rowTabs[id]) this.rowTabs[id] = 'formatted';
          this.$nextTick(() => lucide.createIcons());
        },

        setupPolling() {
          if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
          }
          const sec = Number(this.pollingInterval);
          if (sec > 0) {
            this.pollingTimer = setInterval(() => {
              this.fetchEntries(true);
            }, sec * 1000);
            this.showToast('已启用 ' + sec + ' 秒自动轮询', 'info');
          } else {
            this.showToast('已关闭自动轮询', 'info');
          }
        },

        async downloadFile(filename) {
          window.open('${LOG_VIEWER_PATH}/api/download?file=' + encodeURIComponent(filename), '_blank');
          this.showToast('开始下载日志文件: ' + filename, 'success');
        },

        clearFile(filename) {
          this.openConfirm({
            title: '清空日志文件',
            message: '确定清空日志文件「' + filename + '」的内容吗？此操作将清空该文件内所有已有日志。',
            confirmText: '立即清空',
            isDestructive: true,
            onConfirm: async () => {
              try {
                await fetch('${LOG_VIEWER_PATH}/api/clear', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ file: filename })
                });
                this.showToast('已清空文件 ' + filename, 'success');
                await this.fetchEntries(false);
                await this.fetchFiles();
              } catch (e) {
                this.showToast('清空失败: ' + e.message, 'error');
              }
            }
          });
        },

        deleteFile(filename) {
          this.openConfirm({
            title: '彻底删除日志文件',
            message: '警告：确定彻底删除日志文件「' + filename + '」吗？此操作不可逆！',
            confirmText: '彻底删除',
            isDestructive: true,
            onConfirm: async () => {
              try {
                await fetch('${LOG_VIEWER_PATH}/api/files/' + encodeURIComponent(filename), {
                  method: 'DELETE'
                });
                this.showToast('已彻底删除文件 ' + filename, 'success');
                this.selectedFile = '';
                await this.fetchFiles();
                if (this.files.length > 0) this.selectFile(this.files[0].name);
              } catch (e) {
                this.showToast('删除失败: ' + e.message, 'error');
              }
            }
          });
        },

        copyText(text, label = '已复制到剪贴板！') {
          if (!text) return;
          navigator.clipboard.writeText(text).then(() => {
            this.showToast(label, 'success');
          }).catch(() => {
            this.showToast('复制失败', 'error');
          });
        },

        escapeHtml(str) {
          if (str == null) return '';
          return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        },

        highlightText(text) {
          const safeText = this.escapeHtml(text);
          if (!this.searchKeyword || !this.searchKeyword.trim()) {
            return safeText;
          }
          const kw = this.searchKeyword.trim();
          const escapedKw = kw.replace(/[-[\\]{}()*+?.,\\\\^$|#\\s]/g, '\\\\$&');
          try {
            const regex = new RegExp('(' + escapedKw + ')', 'gi');
            return safeText.replace(regex, '<mark class="search-highlight">$1</mark>');
          } catch {
            return safeText;
          }
        },

        syntaxHighlightJson(obj) {
          if (!obj) return '';
          let json = JSON.stringify(obj, null, 2);
          json = this.escapeHtml(json);

          return json.replace(
            /("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)/g,
            (match) => {
              let cls = 'json-number';
              if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                  cls = 'json-key';
                } else {
                  cls = 'json-string';
                }
              } else if (/true|false/.test(match)) {
                cls = 'json-boolean';
              } else if (/null/.test(match)) {
                cls = 'json-null';
              }
              return '<span class="' + cls + '">' + match + '</span>';
            }
          );
        }
      };
    }
  </script>`;
}
