import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATHS } from '@/common/constants/app.constants';
import {
  clearLogFile,
  deleteLogFile,
  getOrComputeLogFileStats,
  getSafeLogFilePath,
  invalidateLogFileCache,
  LRULogStatCache,
  listLogFiles,
  matchesFilters,
  parseLogLine,
  readLogEntries,
  watchLogTail,
} from '@/setup/log-viewer/reader';

describe('LogViewer Reader (log-viewer/reader.ts)', () => {
  const logsDir = resolve(process.cwd(), PATHS.STORAGE_LOGS);
  const testLogFile = 'reader-test.2026-08-26.1.log';
  const testLogPath = join(logsDir, testLogFile);

  beforeAll(() => {
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }

    const sampleLogs = [
      JSON.stringify({
        level: 30,
        time: 1756200000000,
        pid: 101,
        hostname: 'node-app',
        context: 'AuthService',
        msg: 'User authentication success',
        reqId: 'req-auth-100',
        req: { method: 'POST', url: '/api/v1/auth/login' },
        res: { statusCode: 200 },
        responseTime: 35,
      }),
      JSON.stringify({
        level: 40,
        time: 1756200001000,
        pid: 101,
        hostname: 'node-app',
        context: 'UsersService',
        msg: 'High memory consumption detected',
        reqId: 'req-users-200',
        req: { method: 'GET', url: '/api/v1/users' },
      }),
      JSON.stringify({
        level: 50,
        time: 1756200002000,
        pid: 101,
        hostname: 'node-app',
        context: 'DatabaseService',
        msg: 'Query timeout on users table',
        err: { type: 'TimeoutError', message: 'DB connection timed out', stack: 'Error: timeout\n  at db.ts:25' },
      }),
      JSON.stringify({
        level: 60,
        time: 1756200003000,
        pid: 101,
        hostname: 'node-app',
        msg: 'Fatal uncaught exception in worker process',
      }),
      'Plain text non-JSON log line fallback',
    ].join('\n');

    writeFileSync(testLogPath, sampleLogs, 'utf8');
  });

  afterAll(() => {
    if (existsSync(testLogPath)) {
      unlinkSync(testLogPath);
    }
    invalidateLogFileCache();
  });

  describe('getSafeLogFilePath()', () => {
    it('合法 .log 文件名应返回正确的绝对路径', () => {
      const result = getSafeLogFilePath(testLogFile);
      expect(result).toBe(testLogPath);
    });

    it('非法扩展名文件应抛出异常', () => {
      expect(() => getSafeLogFilePath('passwords.txt')).toThrow('Invalid log file extension');
      expect(() => getSafeLogFilePath('.env')).toThrow('Invalid log file extension');
    });

    it('路径穿越攻击（../../）应被拦截抛错', () => {
      expect(() => getSafeLogFilePath('../../package.json.log')).toThrow('Path traversal detected');
    });
  });

  describe('listLogFiles()', () => {
    it('应返回包含目标日志文件的列表，并具备格式化大小与时间', async () => {
      const files = await listLogFiles(logsDir);
      expect(Array.isArray(files)).toBe(true);

      const target = files.find((f) => f.name === testLogFile);
      expect(target).toBeDefined();
      expect(target?.size).toBeGreaterThan(0);
      expect(target?.sizeFormatted).toContain('B');
      expect(target?.mtime).toBeDefined();
    });
  });

  describe('getOrComputeLogFileStats() - 增量统计缓存', () => {
    it('初次计算应统计正确的级别分布并在未修改时命中缓存', async () => {
      invalidateLogFileCache(testLogFile);
      const stat1 = await getOrComputeLogFileStats(testLogPath, testLogFile);
      expect(stat1.totalLines).toBe(5);
      expect(stat1.countByLevel.info).toBe(2);
      expect(stat1.countByLevel.warn).toBe(1);
      expect(stat1.countByLevel.error).toBe(1);
      expect(stat1.countByLevel.fatal).toBe(1);

      // 第二次调用应直接复用缓存
      const stat2 = await getOrComputeLogFileStats(testLogPath, testLogFile);
      expect(stat2).toBe(stat1);
    });

    it('文件追加新行后应进行增量扫描并自动更新统计', async () => {
      const extraLine = `\n${JSON.stringify({ level: 50, msg: 'Appended error log' })}`;
      appendFileSync(testLogPath, extraLine, 'utf8');

      const updatedStat = await getOrComputeLogFileStats(testLogPath, testLogFile);
      expect(updatedStat.totalLines).toBe(6);
      expect(updatedStat.countByLevel.error).toBe(2);
    });
  });

  describe('readLogEntries() - 倒序反向分块早退引擎', () => {
    it('未指定 file 时应自动选择最新日志文件进行解析', async () => {
      const result = await readLogEntries(logsDir, {});
      expect(result.fileStats).toBeDefined();
      expect(result.meta.total).toBeGreaterThan(0);
    });

    it('指定目标文件倒序查询时应正确解析所有记录并保持倒序', async () => {
      const result = await readLogEntries(logsDir, { file: testLogFile, direction: 'desc' });

      expect(result.meta.total).toBe(6);
      expect(result.items.length).toBe(6);

      // 第一条应为最新追加的 error 日志（倒序）
      expect(result.items[0].msg).toBe('Appended error log');
      expect(result.items[0].level).toBe('error');

      // 第二条应为 plain text
      expect(result.items[1].msg).toBe('Plain text non-JSON log line fallback');
    });

    it('级别过滤应只返回指定级别的日志项', async () => {
      const result = await readLogEntries(logsDir, { file: testLogFile, levels: 'error,fatal' });
      expect(result.items.length).toBe(3); // 2 error + 1 fatal
      const levels = result.items.map((item) => item.level);
      expect(levels).toContain('error');
      expect(levels).toContain('fatal');
    });

    it('全文搜索应支持在 msg、context、reqId、stack、url 中匹配', async () => {
      // 1. msg 匹配
      const res1 = await readLogEntries(logsDir, { file: testLogFile, search: 'authentication success' });
      expect(res1.items.length).toBe(1);
      expect(res1.items[0].context).toBe('AuthService');

      // 2. context 匹配
      const res2 = await readLogEntries(logsDir, { file: testLogFile, search: 'DatabaseService' });
      expect(res2.items.length).toBe(1);
      expect(res2.items[0].level).toBe('error');

      // 3. reqId 匹配
      const res3 = await readLogEntries(logsDir, { file: testLogFile, search: 'req-users-200' });
      expect(res3.items.length).toBe(1);
      expect(res3.items[0].context).toBe('UsersService');

      // 4. url 匹配
      const res4 = await readLogEntries(logsDir, { file: testLogFile, search: '/api/v1/auth/login' });
      expect(res4.items.length).toBe(1);
    });

    it('分页切片应正确限制返回条数与 meta 指标', async () => {
      const result = await readLogEntries(logsDir, { file: testLogFile, page: 1, perPage: 2 });
      expect(result.items.length).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.perPage).toBe(2);
      expect(result.meta.totalPages).toBe(3);
    });

    it('正序查询 (direction=asc) 应从最早日志开始返回', async () => {
      const result = await readLogEntries(logsDir, { file: testLogFile, direction: 'asc' });
      expect(result.items[0].msg).toBe('User authentication success');
      expect(result.items[0].level).toBe('info');
    });

    it('查询不存在的日志文件应抛出异常', async () => {
      await expect(readLogEntries(logsDir, { file: 'non-existent-app.2026-01-01.1.log' })).rejects.toThrow(
        'Log file non-existent-app.2026-01-01.1.log not found',
      );
    });
  });

  describe('watchLogTail() - SSE 响应式追加追踪', () => {
    it('当文件追加新日志时应实时产生 entry 事件', async () => {
      const tailFile = 'tail-test.2026-08-26.1.log';
      const tailPath = join(logsDir, tailFile);
      writeFileSync(tailPath, `${JSON.stringify({ level: 30, msg: 'Initial line' })}\n`, 'utf8');

      const abortController = new AbortController();
      const generator = watchLogTail(
        logsDir,
        { file: tailFile },
        { checkIntervalMs: 50, signal: abortController.signal },
      );

      // 在异步任务中稍微延迟后追加写入日志
      setTimeout(() => {
        appendFileSync(tailPath, `${JSON.stringify({ level: 40, msg: 'Streamed live log' })}\n`, 'utf8');
      }, 100);

      // 读取第一个产生的新事件
      const nextPromise = generator.next();
      const result = await nextPromise;

      abortController.abort();

      expect(result.value).toBeDefined();
      expect(result.value?.type).toBe('entry');
      expect(result.value?.entry?.msg).toBe('Streamed live log');
      expect(result.value?.entry?.level).toBe('warn');

      if (existsSync(tailPath)) {
        unlinkSync(tailPath);
      }
    });
  });

  describe('clearLogFile() & deleteLogFile()', () => {
    it('clearLogFile 应将文件内容截断置空并清理缓存', async () => {
      const tempLogFile = 'temp-clear.2026-08-26.1.log';
      const tempPath = join(logsDir, tempLogFile);
      writeFileSync(tempPath, 'some log data\n', 'utf8');

      await clearLogFile(tempLogFile);
      const content = readFileSync(tempPath, 'utf8');
      expect(content).toBe('');

      unlinkSync(tempPath);
    });

    it('deleteLogFile 应彻底删除文件', async () => {
      const tempLogFile = 'temp-delete.2026-08-26.1.log';
      const tempPath = join(logsDir, tempLogFile);
      writeFileSync(tempPath, 'temporary\n', 'utf8');

      await deleteLogFile(tempLogFile);
      expect(existsSync(tempPath)).toBe(false);
    });
  });

  describe('matchesFilters() - 统一过滤谓词', () => {
    const sampleEntry = parseLogLine(
      JSON.stringify({ level: 50, msg: 'Database connection failed', context: 'DatabaseService' }),
      'app.log',
      1,
    );

    it('当未指定过滤条件时应返回 true', () => {
      expect(matchesFilters(sampleEntry, null, null)).toBe(true);
      expect(matchesFilters(sampleEntry, [], '')).toBe(true);
    });

    it('级别匹配时应返回 true，不匹配时应返回 false', () => {
      expect(matchesFilters(sampleEntry, ['error', 'fatal'], null)).toBe(true);
      expect(matchesFilters(sampleEntry, ['info', 'warn'], null)).toBe(false);
    });

    it('关键词匹配时应返回 true，不匹配时应返回 false', () => {
      expect(matchesFilters(sampleEntry, null, 'database')).toBe(true);
      expect(matchesFilters(sampleEntry, null, 'redis')).toBe(false);
    });

    it('组合级别与关键词过滤均满足才返回 true', () => {
      expect(matchesFilters(sampleEntry, ['error'], 'connection')).toBe(true);
      expect(matchesFilters(sampleEntry, ['error'], 'redis')).toBe(false);
      expect(matchesFilters(sampleEntry, ['info'], 'connection')).toBe(false);
    });
  });

  describe('LRULogStatCache - 容量淘汰机制', () => {
    it('超出容量上限时应淘汰最久未访问的条目', () => {
      const cache = new LRULogStatCache(3);
      const dummyStat = {
        mtimeMs: 100,
        size: 10,
        totalLines: 1,
        countByLevel: { fatal: 0, error: 0, warn: 0, info: 1, debug: 0, trace: 0 },
      };

      cache.set('file1.log', dummyStat);
      cache.set('file2.log', dummyStat);
      cache.set('file3.log', dummyStat);
      expect(cache.size).toBe(3);

      // 访问 file1.log，使其成为最新访问
      cache.get('file1.log');

      // 插入第 4 个条目，应淘汰 file2.log（最久未访问）
      cache.set('file4.log', dummyStat);
      expect(cache.size).toBe(3);
      expect(cache.get('file2.log')).toBeUndefined();
      expect(cache.get('file1.log')).toBeDefined();
      expect(cache.get('file3.log')).toBeDefined();
      expect(cache.get('file4.log')).toBeDefined();
    });
  });

  describe('UTF-8 跨块多字节中文字节截断安全与超长单行解析', () => {
    it('跨越 64KB 块边界的中文日志倒序读取时绝无乱码 (\\uFFFD)', async () => {
      const utf8TestFile = 'utf8-multibyte-test.2026-08-26.1.log';
      const utf8TestPath = join(logsDir, utf8TestFile);

      // 构造超过 128KB (跨越多个 64KB 块) 的中文结构化日志
      const chineseLogLines: string[] = [];
      for (let i = 0; i < 800; i++) {
        chineseLogLines.push(
          JSON.stringify({
            level: 30,
            time: 1756200000000 + i * 1000,
            msg: `【第 ${i} 次操作】用户「张三」在控制台执行了敏感权限变更，操作耗时: ${i}ms`,
            context: 'AuditService',
          }),
        );
      }

      writeFileSync(utf8TestPath, `${chineseLogLines.join('\n')}\n`, 'utf8');

      // 倒序读取第 1 页 (25 条)
      const resPage1 = await readLogEntries(logsDir, { file: utf8TestFile, page: 1, perPage: 25, direction: 'desc' });
      expect(resPage1.items.length).toBe(25);

      // 验证所有中文消息没有乱码
      for (const item of resPage1.items) {
        expect(item.msg).not.toContain('\uFFFD');
        expect(item.msg).toContain('用户「张三」');
      }

      // 倒序读取跨越块边界的中间页 (第 20 页)
      const resPage20 = await readLogEntries(logsDir, { file: utf8TestFile, page: 20, perPage: 25, direction: 'desc' });
      expect(resPage20.items.length).toBe(25);
      for (const item of resPage20.items) {
        expect(item.msg).not.toContain('\uFFFD');
        expect(item.msg).toContain('用户「张三」');
      }

      if (existsSync(utf8TestPath)) {
        unlinkSync(utf8TestPath);
      }
    });

    it('单行超过 64KB 的超长日志跨块也能完整还原解析', async () => {
      const hugeLineFile = 'huge-line-test.2026-08-26.1.log';
      const hugeLinePath = join(logsDir, hugeLineFile);

      // 构造 80KB 的超长 payload
      const hugePayload = 'A'.repeat(80 * 1024);
      const hugeLog = JSON.stringify({
        level: 50,
        time: 1756200099000,
        msg: 'Large payload error',
        context: 'PayloadService',
        rawPayload: hugePayload,
      });

      writeFileSync(hugeLinePath, `${hugeLog}\n`, 'utf8');

      const result = await readLogEntries(logsDir, { file: hugeLineFile, page: 1, perPage: 10, direction: 'desc' });
      expect(result.items.length).toBe(1);
      expect(result.items[0].msg).toBe('Large payload error');
      expect((result.items[0].raw as { rawPayload?: string }).rawPayload?.length).toBe(80 * 1024);

      if (existsSync(hugeLinePath)) {
        unlinkSync(hugeLinePath);
      }
    });
  });
});
