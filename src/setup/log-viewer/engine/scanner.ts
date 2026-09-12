import { createReadStream, existsSync, promises as fsPromises } from 'node:fs';
import { createInterface } from 'node:readline';
import { compact } from 'es-toolkit';
import {
  ALL_LOG_LEVELS,
  EVENT_LOOP_YIELD_INTERVAL,
  formatBytes,
  LEVEL_MAP,
  LOG_CHUNK_SIZE,
  type LogEntriesQuery,
  type LogEntriesResult,
  type LogFileStatCache,
  MAX_LOG_LINE_BYTES,
  MAX_SEARCH_SCAN_BYTES,
  MAX_STAT_CACHE_ENTRIES,
  type ParsedLogEntry,
} from '../constants';
import { getSafeLogFilePath, listLogFiles } from './file-ops';
import { matchesFilters, parseLogLine } from './parser';

/**
 * 基于 Map 访问顺序实现的轻量级 LRU 日志文件统计缓存 (防内存泄漏)
 */
export class LRULogStatCache {
  private readonly map = new Map<string, LogFileStatCache>();
  private readonly maxEntries: number;

  constructor(maxEntries = MAX_STAT_CACHE_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  get(filename: string): LogFileStatCache | undefined {
    const item = this.map.get(filename);
    if (!item) return undefined;
    // 刷新访问顺序至队尾
    this.map.delete(filename);
    this.map.set(filename, item);
    return item;
  }

  set(filename: string, value: LogFileStatCache): void {
    if (this.map.has(filename)) {
      this.map.delete(filename);
    } else if (this.map.size >= this.maxEntries) {
      // 淘汰最久未访问的队首条目
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(filename, value);
  }

  delete(filename: string): boolean {
    return this.map.delete(filename);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/** 内部文件级别统计与行数 LRU 缓存实例 */
export const statCache = new LRULogStatCache();

/**
 * 手动使指定或全部日志文件的统计缓存失效
 */
export function invalidateLogFileCache(filename?: string): void {
  if (filename) {
    statCache.delete(filename);
  } else {
    statCache.clear();
  }
}

function recordLineLevel(line: string, countByLevel: Record<string, number>): void {
  try {
    const raw = JSON.parse(line);
    const levelNum = typeof raw.level === 'number' ? raw.level : 30;
    const lvl = LEVEL_MAP[levelNum] || 'info';
    countByLevel[lvl] = (countByLevel[lvl] || 0) + 1;
  } catch {
    countByLevel.info = (countByLevel.info || 0) + 1;
  }
}

/**
 * 获取或增量计算日志文件的元数据统计（含各级别统计与总行数）
 */
export async function getOrComputeLogFileStats(filePath: string, filename: string): Promise<LogFileStatCache> {
  const stats = await fsPromises.stat(filePath);
  const cached = statCache.get(filename);

  // 1. 完全命中缓存
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached;
  }

  // 2. 空文件快捷处理
  if (stats.size === 0) {
    const emptyCache: LogFileStatCache = {
      mtimeMs: stats.mtimeMs,
      size: 0,
      totalLines: 0,
      countByLevel: { fatal: 0, error: 0, warn: 0, info: 0, debug: 0, trace: 0 },
    };
    statCache.set(filename, emptyCache);
    return emptyCache;
  }

  // 3. 增量追加扫描 (文件仅增量增长)
  if (cached && stats.size > cached.size && stats.mtimeMs >= cached.mtimeMs) {
    try {
      const appendLength = stats.size - cached.size;
      const fd = await fsPromises.open(filePath, 'r');
      try {
        const buffer = Buffer.alloc(appendLength);
        await fd.read(buffer, 0, appendLength, cached.size);
        const appendedText = buffer.toString('utf8');
        const lines = appendedText.split(/\r?\n/);
        const countByLevel = { ...cached.countByLevel };
        let addedLines = 0;

        for (const line of lines) {
          if (!line.trim()) continue;
          addedLines++;
          recordLineLevel(line, countByLevel);
        }

        const updatedCache: LogFileStatCache = {
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          totalLines: cached.totalLines + addedLines,
          countByLevel,
        };
        statCache.set(filename, updatedCache);
        return updatedCache;
      } finally {
        await fd.close();
      }
    } catch {
      // 增量读取异常时降级为全量扫描
    }
  }

  // 4. 全量快速流扫描
  const countByLevel: Record<string, number> = {
    fatal: 0,
    error: 0,
    warn: 0,
    info: 0,
    debug: 0,
    trace: 0,
  };
  let totalLines = 0;
  const fileStream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Number.POSITIVE_INFINITY });

  for await (const line of rl) {
    if (!line.trim()) continue;
    totalLines++;
    recordLineLevel(line, countByLevel);
  }

  const fullCache: LogFileStatCache = {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    totalLines,
    countByLevel,
  };
  statCache.set(filename, fullCache);
  return fullCache;
}

/**
 * 从 EOF 倒序分块读取并解析日志行，采用零 GC 共享 Buffer 与纯字节级换行 (lastIndexOf 0x0A) 扫描
 */
export async function readLogEntriesReverse(
  filePath: string,
  targetFile: string,
  options: {
    limit: number;
    filterLevels: string[] | null;
    searchKeyword: string | null;
  },
): Promise<{ items: ParsedLogEntry[]; totalMatches: number; scannedAll: boolean }> {
  const stats = await fsPromises.stat(filePath);
  if (stats.size === 0) {
    return { items: [], totalMatches: 0, scannedAll: true };
  }

  const fd = await fsPromises.open(filePath, 'r');
  const items: ParsedLogEntry[] = [];
  const chunkBuffer = Buffer.allocUnsafe(LOG_CHUNK_SIZE);
  let position = stats.size;
  let leftoverBytes: Buffer = Buffer.alloc(0);
  let virtualLineIndex = 0;
  let totalBytesScanned = 0;
  let chunkCount = 0;
  const isCustomFiltered = Boolean(
    options.searchKeyword || (options.filterLevels && options.filterLevels.length < ALL_LOG_LEVELS.length),
  );

  try {
    while (position > 0) {
      // 工业级防霸占 Event Loop：每扫描 16 个 block (1MB) 让出一次调度
      chunkCount++;
      if (chunkCount % EVENT_LOOP_YIELD_INTERVAL === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      const readLength = Math.min(LOG_CHUNK_SIZE, position);
      position -= readLength;
      totalBytesScanned += readLength;
      await fd.read(chunkBuffer, 0, readLength, position);

      const rawChunkSlice = chunkBuffer.subarray(0, readLength);
      const currentBlock = leftoverBytes.length > 0 ? Buffer.concat([rawChunkSlice, leftoverBytes]) : rawChunkSlice;

      let endIdx = currentBlock.length;

      while (endIdx > 0) {
        const newlineIdx = currentBlock.lastIndexOf(0x0a, endIdx - 1);

        if (newlineIdx === -1) {
          // 当前块中不再有换行符
          if (position > 0) {
            // 未到达文件头部，剩余 [0, endIdx) 作为跨块残缺行保留
            if (endIdx > MAX_LOG_LINE_BYTES) {
              // 超过 5MB 熔断保护，防止内存被超大单行撑爆
              leftoverBytes = Buffer.alloc(0);
            } else {
              leftoverBytes = Buffer.from(currentBlock.subarray(0, endIdx));
            }
          } else {
            // 到达文件绝对头部，[0, endIdx) 即为文件的第一行
            const lineBuf = currentBlock.subarray(0, endIdx);
            let lineEnd = lineBuf.length;
            if (lineEnd > 0 && lineBuf[lineEnd - 1] === 0x0d) {
              lineEnd--;
            }
            const lineSlice = lineBuf.subarray(0, lineEnd);
            const lineStr = lineSlice.toString('utf8').trim();
            if (lineStr) {
              virtualLineIndex++;
              const entry = parseLogLine(lineStr, targetFile, virtualLineIndex);
              if (matchesFilters(entry, options.filterLevels, options.searchKeyword)) {
                items.push(entry);
              }
            }
            leftoverBytes = Buffer.alloc(0);
          }
          break;
        }

        // 找到了换行符 newlineIdx，提取 (newlineIdx, endIdx) 之间的字节作为单行
        const lineBuf = currentBlock.subarray(newlineIdx + 1, endIdx);
        endIdx = newlineIdx;

        let lineEnd = lineBuf.length;
        if (lineEnd > 0 && lineBuf[lineEnd - 1] === 0x0d) {
          lineEnd--;
        }
        const lineSlice = lineBuf.subarray(0, lineEnd);
        if (lineSlice.length === 0) {
          continue; // 空行跳过
        }

        // 此时 lineSlice 为完整单行的原始字节切片，转换为 UTF-8 字符串绝无截断乱码
        const lineStr = lineSlice.toString('utf8').trim();
        if (!lineStr) continue;

        virtualLineIndex++;
        const entry = parseLogLine(lineStr, targetFile, virtualLineIndex);

        if (!matchesFilters(entry, options.filterLevels, options.searchKeyword)) {
          continue;
        }

        items.push(entry);

        // 1. 无自定义全文搜索且未收窄级别时，总数由 statCache 保证，达到 limit 即可秒级早退
        if (!isCustomFiltered) {
          if (items.length >= options.limit) {
            return { items, totalMatches: items.length, scannedAll: false };
          }
        } else {
          // 2. 自定义搜索/收窄级别：当扫描字节超出 100MB 熔断阈值且已收集到足够当前页条目时，安全熔断早退
          if (totalBytesScanned >= MAX_SEARCH_SCAN_BYTES && items.length >= options.limit) {
            return { items, totalMatches: items.length, scannedAll: false };
          }
        }
      }
    }

    return { items, totalMatches: items.length, scannedAll: true };
  } finally {
    await fd.close();
  }
}

/**
 * 读取并流式解析日志文件，支持多维过滤、倒序排列与分页
 */
export async function readLogEntries(logsDir: string, query: LogEntriesQuery): Promise<LogEntriesResult> {
  const startTime = Date.now();

  // 1. 确定目标文件
  let targetFile = query.file;
  if (!targetFile) {
    const allFiles = await listLogFiles(logsDir);
    if (allFiles.length === 0) {
      return {
        items: [],
        meta: { total: 0, page: 1, perPage: 25, totalPages: 0, countByLevel: {} },
        fileStats: null,
        performance: { durationMs: Date.now() - startTime, memory: '0 MB' },
      };
    }
    targetFile = allFiles[0].name;
  }

  const filePath = getSafeLogFilePath(targetFile);
  if (!existsSync(filePath)) {
    throw new Error(`Log file ${targetFile} not found`);
  }

  const stats = await fsPromises.stat(filePath);
  const page = Math.max(1, Number.parseInt(String(query.page || 1), 10));
  const perPage = Math.max(1, Number.parseInt(String(query.perPage || 25), 10));
  const filterLevels = query.levels ? compact(query.levels.split(',').map((l) => l.trim().toLowerCase())) : null;
  const searchKeyword = query.search ? query.search.trim().toLowerCase() : null;
  const direction = query.direction === 'asc' ? 'asc' : 'desc';

  // 2. 从增量缓存获取各级别计数与总行数
  const cachedStats = await getOrComputeLogFileStats(filePath, targetFile);
  const countByLevel = { ...cachedStats.countByLevel };

  let items: ParsedLogEntry[] = [];
  let total = 0;
  const hasFilter = Boolean(searchKeyword || (filterLevels && filterLevels.length < ALL_LOG_LEVELS.length));

  // 3. 倒序读取（默认）采用 ReverseChunk 极速早退引擎
  if (direction === 'desc') {
    const neededLimit = page * perPage;
    const reverseResult = await readLogEntriesReverse(filePath, targetFile, {
      limit: neededLimit,
      filterLevels,
      searchKeyword,
    });

    if (!hasFilter) {
      total = cachedStats.totalLines;
    } else {
      total = reverseResult.totalMatches;
    }

    const startIndex = (page - 1) * perPage;
    items = reverseResult.items.slice(startIndex, startIndex + perPage);
  } else {
    // 正序读取采用顺序流
    const fileStream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Number.POSITIVE_INFINITY });
    const allFiltered: ParsedLogEntry[] = [];
    let lineIndex = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;
      lineIndex++;
      const entry = parseLogLine(line, targetFile, lineIndex);

      if (!matchesFilters(entry, filterLevels, searchKeyword)) {
        continue;
      }
      allFiltered.push(entry);
    }

    total = allFiltered.length;
    const startIndex = (page - 1) * perPage;
    items = allFiltered.slice(startIndex, startIndex + perPage);
  }

  const totalPages = Math.ceil(total / perPage);
  const mem = process.memoryUsage();
  const durationMs = Date.now() - startTime;

  return {
    items,
    meta: {
      total,
      page,
      perPage,
      totalPages,
      countByLevel,
    },
    fileStats: {
      name: targetFile,
      size: stats.size,
      sizeFormatted: formatBytes(stats.size),
      mtime: stats.mtime.toISOString(),
    },
    performance: {
      durationMs,
      memory: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    },
  };
}

/**
 * 清空指定日志文件内容并清除缓存
 */
export async function clearLogFile(filename: string): Promise<void> {
  const filePath = getSafeLogFilePath(filename);
  await fsPromises.writeFile(filePath, '');
  invalidateLogFileCache(filename);
}

/**
 * 删除指定日志文件并清除缓存
 */
export async function deleteLogFile(filename: string): Promise<void> {
  const filePath = getSafeLogFilePath(filename);
  await fsPromises.unlink(filePath);
  invalidateLogFileCache(filename);
}
