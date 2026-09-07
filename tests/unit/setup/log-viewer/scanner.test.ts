import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getOrComputeLogFileStats, LRULogStatCache, readLogEntriesReverse } from '@/setup/log-viewer/engine/scanner';

describe('LogViewer Scanner (engine/scanner.ts)', () => {
  const testDir = join(process.cwd(), 'storage', 'tmp', `test-scanner-${Date.now()}`);
  const testLogFile = join(testDir, 'scanner-test.log');

  beforeAll(async () => {
    await fsPromises.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await fsPromises.rm(testDir, { recursive: true, force: true });
  });

  describe('LRULogStatCache', () => {
    it('应按访问顺序正确刷新并在超过 maxEntries 时淘汰最旧条目', () => {
      const cache = new LRULogStatCache(2);
      const dummyStat = {
        mtimeMs: 100,
        size: 500,
        totalLines: 10,
        countByLevel: { info: 10 },
      };

      cache.set('file-a.log', { ...dummyStat });
      cache.set('file-b.log', { ...dummyStat });
      expect(cache.size).toBe(2);

      // 访问 file-a 刷新访问顺序
      cache.get('file-a.log');

      // 插入第三个，应淘汰 file-b
      cache.set('file-c.log', { ...dummyStat });
      expect(cache.size).toBe(2);
      expect(cache.get('file-a.log')).toBeDefined();
      expect(cache.get('file-b.log')).toBeUndefined();
      expect(cache.get('file-c.log')).toBeDefined();
    });

    it('clear 应清空全部缓存', () => {
      const cache = new LRULogStatCache(10);
      cache.set('file-1.log', { mtimeMs: 1, size: 1, totalLines: 1, countByLevel: {} });
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe('getOrComputeLogFileStats & readLogEntriesReverse', () => {
    it('空文件应返回全 0 的统计对象与空 items', async () => {
      const emptyFile = join(testDir, 'empty.log');
      await fsPromises.writeFile(emptyFile, '');

      const stats = await getOrComputeLogFileStats(emptyFile, 'empty.log');
      expect(stats.totalLines).toBe(0);
      expect(stats.size).toBe(0);

      const reverse = await readLogEntriesReverse(emptyFile, 'empty.log', {
        limit: 10,
        filterLevels: null,
        searchKeyword: null,
      });
      expect(reverse.items).toHaveLength(0);
      expect(reverse.totalMatches).toBe(0);
    });

    it('多行日志应倒序返回最新条目并统计各级别总数', async () => {
      const lines = [
        JSON.stringify({ level: 30, msg: 'First info line', time: 1000 }),
        JSON.stringify({ level: 40, msg: 'Second warn line', time: 2000 }),
        JSON.stringify({ level: 50, msg: 'Third error line', time: 3000 }),
      ].join('\n');

      await fsPromises.writeFile(testLogFile, `${lines}\n`);

      const stats = await getOrComputeLogFileStats(testLogFile, 'scanner-test.log');
      expect(stats.totalLines).toBe(3);
      expect(stats.countByLevel.info).toBe(1);
      expect(stats.countByLevel.warn).toBe(1);
      expect(stats.countByLevel.error).toBe(1);

      const reverse = await readLogEntriesReverse(testLogFile, 'scanner-test.log', {
        limit: 2,
        filterLevels: null,
        searchKeyword: null,
      });

      // 倒序：第一条应该是 Third error line
      expect(reverse.items[0].msg).toBe('Third error line');
      expect(reverse.items[0].level).toBe('error');
    });
  });
});
