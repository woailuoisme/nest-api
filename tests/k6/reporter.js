import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

/**
 * ==============================================================================
 * k6 现代交互式测试报告生成器 (Tailwind CSS 4 + Alpine.js + 离线兜底)
 * ==============================================================================
 */

/**
 * 格式化数值/毫秒
 * @param {number} val
 * @param {number} [digits=2]
 */
function formatNum(val, digits = 2) {
  if (val === undefined || val === null || Number.isNaN(val)) return '0';
  return Number(val).toFixed(digits);
}

/**
 * 格式化字节大小
 * @param {number} bytes
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

/**
 * 获取格式化时间戳 (YYYYMMDD-HHmmss)
 */
function getReportTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = now.getFullYear();
  const MM = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${yyyy}${MM}${dd}-${hh}${mm}${ss}`;
}

/**
 * 生成基于 Tailwind CSS 4 + Alpine.js 的现代化交互式 HTML 报告 (含离线原生 CSS 兜底)
 * @param {Object} data - k6 原始 summary 数据
 * @param {string} title - 报告标题
 * @returns {string} HTML 字符串
 */
function generateHtmlReport(data, title) {
  const metrics = data.metrics || {};

  // 基础核心指标
  const httpReqs = metrics.http_reqs ? metrics.http_reqs.values.count : 0;
  const httpReqRate = metrics.http_reqs ? metrics.http_reqs.values.rate : 0;
  const httpFailedRate = metrics.http_req_failed ? metrics.http_req_failed.values.rate * 100 : 0;
  const httpDuration = metrics.http_req_duration ? metrics.http_req_duration.values : {};
  const vusMax = metrics.vus_max ? metrics.vus_max.values.max : metrics.vus ? metrics.vus.values.value : 0;
  const dataReceived = metrics.data_received ? metrics.data_received.values.count : 0;
  const dataSent = metrics.data_sent ? metrics.data_sent.values.count : 0;

  // 阈值解析
  const thresholdsList = [];
  let allThresholdsPassed = true;

  for (const [metricName, metricData] of Object.entries(metrics)) {
    if (metricData.thresholds) {
      for (const [threshName, threshVal] of Object.entries(metricData.thresholds)) {
        const passed = threshVal.ok;
        if (!passed) allThresholdsPassed = false;
        thresholdsList.push({
          metric: metricName,
          threshold: threshName,
          passed,
        });
      }
    }
  }

  // 检查项 (Checks)
  const checksRate = metrics.checks ? metrics.checks.values.rate * 100 : 100;
  const checksPassed = metrics.checks ? metrics.checks.values.passes : 0;
  const checksFailed = metrics.checks ? metrics.checks.values.fails : 0;

  function extractDurationItem(values, name) {
    if (!values) return null;
    return {
      name,
      avg: formatNum(values.avg),
      med: formatNum(values.med),
      p90: formatNum(values['p(90)']),
      p95: formatNum(values['p(95)']),
      p99: formatNum(values['p(99)']),
      min: formatNum(values.min),
      max: formatNum(values.max),
    };
  }

  const durationList = [
    extractDurationItem(httpDuration, 'http_req_duration (总响应时延)'),
    extractDurationItem(metrics.user_me_duration?.values, 'user_me_duration (个人信息查询)'),
    extractDurationItem(metrics.user_list_duration?.values, 'user_list_duration (用户列表分页)'),
    extractDurationItem(metrics.health_duration?.values, 'health_duration (健康探针)'),
    extractDurationItem(metrics.register_duration?.values, 'register_duration (用户注册/哈希)'),
  ].filter(Boolean);

  const reportPayload = {
    title,
    generatedAt: new Date().toLocaleString(),
    allPassed: allThresholdsPassed,
    summary: {
      totalRequests: httpReqs,
      reqRate: formatNum(httpReqRate),
      failedRate: formatNum(httpFailedRate),
      maxVUs: vusMax,
      p95Duration: formatNum(httpDuration['p(95)']),
      p99Duration: formatNum(httpDuration['p(99)']),
      avgDuration: formatNum(httpDuration.avg),
      dataReceived: formatBytes(dataReceived),
      dataSent: formatBytes(dataSent),
      checksPassed,
      checksFailed,
      checksRate: formatNum(checksRate),
    },
    thresholds: thresholdsList,
    durations: durationList,
    rawJson: data,
  };

  return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <!-- 离线原生暗黑样式兜底 (在无网络或 CDN 无法加载时保证可用排版) -->
  <style>
    :root { color-scheme: dark; }
    body { background-color: #020617; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 1.5rem; line-height: 1.5; }
    .container { max-width: 72rem; margin: 0 auto; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
    th, td { padding: 0.75rem 1rem; border-bottom: 1px solid #1e293b; text-align: left; }
    th { background: #0f172a; color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; }
    .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 0.75rem; padding: 1.25rem; }
  </style>
  <!-- Tailwind CSS 4 CDN -->
  <script src="https://unpkg.com/@tailwindcss/browser@4"></script>
  <!-- Alpine.js CDN -->
  <script defer src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js"></script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased p-4 md:p-8" x-data="reportApp()">

  <div class="max-w-6xl mx-auto space-y-6 container">

    <!-- 顶部 Header -->
    <header class="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900/80 border border-slate-800 rounded-2xl backdrop-blur-md shadow-xl card">
      <div>
        <div class="flex items-center gap-3">
          <span class="text-2xl font-bold tracking-tight bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent" x-text="title">${title}</span>
        </div>
        <p class="text-sm text-slate-400 mt-1">NestForge 性能评测 • 生成时间：<span x-text="generatedAt">${reportPayload.generatedAt}</span></p>
      </div>

      <div class="flex items-center gap-3">
        <template x-if="allPassed">
          <span class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            SLA 全部达标 (PASSED)
          </span>
        </template>
        <template x-if="!allPassed">
          <span class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-sm">
            <span class="w-2 h-2 rounded-full bg-rose-400"></span>
            存在超标项 (FAILED)
          </span>
        </template>
      </div>
    </header>

    <!-- 核心指标卡片矩阵 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="p-5 bg-slate-900 border border-slate-800/80 rounded-xl card">
        <div class="text-xs font-medium uppercase tracking-wider text-slate-400">总请求数 / 吞吐率</div>
        <div class="text-2xl font-bold text-sky-400 mt-2" x-text="summary.totalRequests.toLocaleString()">${httpReqs.toLocaleString()}</div>
        <div class="text-xs text-slate-400 mt-1" x-text="'均 ' + summary.reqRate + ' req/s'">均 ${formatNum(httpReqRate)} req/s</div>
      </div>

      <div class="p-5 bg-slate-900 border border-slate-800/80 rounded-xl card">
        <div class="text-xs font-medium uppercase tracking-wider text-slate-400">P95 响应时延</div>
        <div class="text-2xl font-bold text-indigo-400 mt-2" x-text="summary.p95Duration + ' ms'">${formatNum(httpDuration['p(95)'])} ms</div>
        <div class="text-xs text-slate-400 mt-1" x-text="'P99: ' + summary.p99Duration + 'ms | 均: ' + summary.avgDuration + 'ms'">P99: ${formatNum(httpDuration['p(99)'])}ms | 均: ${formatNum(httpDuration.avg)}ms</div>
      </div>

      <div class="p-5 bg-slate-900 border border-slate-800/80 rounded-xl card">
        <div class="text-xs font-medium uppercase tracking-wider text-slate-400">请求错误率</div>
        <div class="text-2xl font-bold mt-2 ${httpFailedRate > 1 ? 'text-rose-400' : 'text-emerald-400'}"
             :class="Number(summary.failedRate) > 1 ? 'text-rose-400' : 'text-emerald-400'"
             x-text="summary.failedRate + '%'">
          ${formatNum(httpFailedRate)}%
        </div>
        <div class="text-xs text-slate-400 mt-1" x-text="'断言通过率: ' + summary.checksRate + '%'">断言通过率: ${formatNum(checksRate)}%</div>
      </div>

      <div class="p-5 bg-slate-900 border border-slate-800/80 rounded-xl card">
        <div class="text-xs font-medium uppercase tracking-wider text-slate-400">最大并发 (VUs)</div>
        <div class="text-2xl font-bold text-amber-400 mt-2" x-text="summary.maxVUs">${vusMax}</div>
        <div class="text-xs text-slate-400 mt-1" x-text="'下行: ' + summary.dataReceived + ' | 上行: ' + summary.dataSent">下行: ${formatBytes(dataReceived)} | 上行: ${formatBytes(dataSent)}</div>
      </div>
    </div>

    <!-- 动态 Tab 导航与操作栏 -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl card">
      <div class="flex flex-col sm:flex-row items-center justify-between border-b border-slate-800 px-6 py-3 gap-3">
        <nav class="flex space-x-2">
          <button @click="currentTab = 'durations'"
                  class="px-4 py-2 text-sm font-medium rounded-lg transition"
                  :class="currentTab === 'durations' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-slate-400 hover:text-slate-200'">
            响应时延阶梯
          </button>
          <button @click="currentTab = 'thresholds'"
                  class="px-4 py-2 text-sm font-medium rounded-lg transition"
                  :class="currentTab === 'thresholds' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-slate-400 hover:text-slate-200'">
            SLA 质量守门
          </button>
          <button @click="currentTab = 'json'"
                  class="px-4 py-2 text-sm font-medium rounded-lg transition"
                  :class="currentTab === 'json' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'text-slate-400 hover:text-slate-200'">
            原始 JSON
          </button>
        </nav>

        <!-- 搜索与状态过滤器 (在 SLA 标签下显示) -->
        <div class="flex items-center gap-2 w-full sm:w-auto" x-show="currentTab === 'thresholds'">
          <input type="text" x-model="searchQuery" placeholder="搜索指标名称..."
                 class="px-3 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 w-full sm:w-48">
          <select x-model="statusFilter" class="px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none">
            <option value="all">全部状态</option>
            <option value="passed">仅通过</option>
            <option value="failed">仅未达标</option>
          </select>
        </div>
      </div>

      <!-- Tab 1: 响应时延阶梯明细 -->
      <div class="p-6 overflow-x-auto" x-show="currentTab === 'durations'">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="text-xs text-slate-400 uppercase border-b border-slate-800/80 bg-slate-950/40">
              <th class="py-3.5 px-4 font-semibold">端点 / 动作指标</th>
              <th class="py-3.5 px-4 font-semibold">平均值 (Avg)</th>
              <th class="py-3.5 px-4 font-semibold">中位数 (Med)</th>
              <th class="py-3.5 px-4 font-semibold">P90</th>
              <th class="py-3.5 px-4 font-semibold text-sky-400">P95</th>
              <th class="py-3.5 px-4 font-semibold">P99</th>
              <th class="py-3.5 px-4 font-semibold">最小值</th>
              <th class="py-3.5 px-4 font-semibold">最大值</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60">
            <template x-for="d in durations" :key="d.name">
              <tr class="hover:bg-slate-800/30 transition">
                <td class="py-3.5 px-4 font-mono font-medium text-slate-200" x-text="d.name"></td>
                <td class="py-3.5 px-4 text-slate-300" x-text="d.avg + ' ms'"></td>
                <td class="py-3.5 px-4 text-slate-300" x-text="d.med + ' ms'"></td>
                <td class="py-3.5 px-4 text-slate-300" x-text="d.p90 + ' ms'"></td>
                <td class="py-3.5 px-4 font-semibold text-sky-400" x-text="d.p95 + ' ms'"></td>
                <td class="py-3.5 px-4 text-slate-300" x-text="d.p99 + ' ms'"></td>
                <td class="py-3.5 px-4 text-slate-400" x-text="d.min + ' ms'"></td>
                <td class="py-3.5 px-4 text-slate-400" x-text="d.max + ' ms'"></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- Tab 2: SLA 质量守门过滤列表 -->
      <div class="p-6 overflow-x-auto" x-show="currentTab === 'thresholds'">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="text-xs text-slate-400 uppercase border-b border-slate-800/80 bg-slate-950/40">
              <th class="py-3.5 px-4 font-semibold">状态</th>
              <th class="py-3.5 px-4 font-semibold">度量指标</th>
              <th class="py-3.5 px-4 font-semibold">SLA 守门条件</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60">
            <template x-for="(t, index) in filteredThresholds" :key="index">
              <tr class="hover:bg-slate-800/30 transition">
                <td class="py-3.5 px-4">
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold"
                        :class="t.passed ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'">
                    <span class="w-1.5 h-1.5 rounded-full" :class="t.passed ? 'bg-emerald-400' : 'bg-rose-400'"></span>
                    <span x-text="t.passed ? 'PASSED' : 'FAILED'"></span>
                  </span>
                </td>
                <td class="py-3.5 px-4 font-mono text-slate-200" x-text="t.metric"></td>
                <td class="py-3.5 px-4 font-mono text-slate-400" x-text="t.threshold"></td>
              </tr>
            </template>
            <template x-if="filteredThresholds.length === 0">
              <tr>
                <td colspan="3" class="py-8 text-center text-slate-500">无匹配的 SLA 规则</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- Tab 3: 原始 JSON 查看与复制 -->
      <div class="p-6" x-show="currentTab === 'json'">
        <div class="flex justify-end mb-3">
          <button @click="copyJson()" class="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition flex items-center gap-1.5">
            <span x-text="copied ? '已复制到剪贴板' : '复制 JSON 数据'"></span>
          </button>
        </div>
        <pre class="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs font-mono text-slate-300 max-h-96 overflow-y-auto" x-text="JSON.stringify(rawJson, null, 2)"></pre>
      </div>

    </div>

    <!-- 底部 Footer -->
    <footer class="text-center text-xs text-slate-500 py-4">
      Generated automatically by k6 & NestForge • Powered by Tailwind CSS 4 & Alpine.js
    </footer>

  </div>

  <!-- 安全数据挂载点 (避免属性转义缺陷) -->
  <script id="k6-report-data" type="application/json">
${JSON.stringify(reportPayload)}
  </script>

  <script>
    function reportApp() {
      const dataEl = document.getElementById('k6-report-data');
      const initialData = dataEl ? JSON.parse(dataEl.textContent) : {};
      return {
        ...initialData,
        currentTab: 'durations',
        searchQuery: '',
        statusFilter: 'all',
        copied: false,
        get filteredThresholds() {
          return (this.thresholds || []).filter(t => {
            const matchesQuery = t.metric.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
                                 t.threshold.toLowerCase().includes(this.searchQuery.toLowerCase());
            const matchesStatus = this.statusFilter === 'all' ||
                                  (this.statusFilter === 'passed' && t.passed) ||
                                  (this.statusFilter === 'failed' && !t.passed);
            return matchesQuery && matchesStatus;
          });
        },
        copyJson() {
          navigator.clipboard.writeText(JSON.stringify(this.rawJson, null, 2));
          this.copied = true;
          setTimeout(() => { this.copied = false; }, 2000);
        }
      };
    }
  </script>
</body>
</html>`;
}

/**
 * k6 报告导出统一入口
 * @param {Object} data - k6 内部汇总数据
 * @param {Object} [options]
 * @param {string} [options.title] - 报告标题
 * @param {string} [options.scenario] - 场景名称 (如 smoke, load, stress)
 * @returns {Object} 输出映射文件
 */
export function handleSummaryGenerator(data, options = {}) {
  const title = options.title || 'NestForge k6 Performance Test Report';
  const scenario = (options.scenario || __ENV.SCENARIO || 'summary').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const timestamp = getReportTimestamp();
  const html = generateHtmlReport(data, title);
  const jsonStr = JSON.stringify(data, null, 2);

  let consoleSummary = '';
  try {
    consoleSummary = textSummary(data, { indent: ' ', enableColors: true });
  } catch {
    consoleSummary = `\n--- k6 Test Summary ---\nRequests: ${data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0}\n`;
  }

  // 1. 独立历史归档文件：storage/logs/k6-reports/<scenario>-<timestamp>.[html|json]
  const archiveBase = `storage/logs/k6-reports/${scenario}-${timestamp}`;
  // 2. 归档目录下的最新便捷入口：storage/logs/k6-reports/latest.[html|json]
  const latestBase = 'storage/logs/k6-reports/latest';

  return {
    stdout: consoleSummary,
    [`${archiveBase}.html`]: html,
    [`${archiveBase}.json`]: jsonStr,
    [`${latestBase}.html`]: html,
    [`${latestBase}.json`]: jsonStr,
  };
}
