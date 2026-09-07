import { existsSync, promises as fsPromises } from 'node:fs';
import { compact, delay } from 'es-toolkit';
import type { LogStreamQuery, LogTailEvent } from '../constants';
import { getSafeLogFilePath, listLogFiles } from './file-ops';
import { matchesFilters, parseLogLine } from './parser';

/**
 * 响应式实时追踪日志尾部追加 (SSE 异步生成器，具备断连保护与文件轮转自愈)
 */
export async function* watchLogTail(
  logsDir: string,
  query: LogStreamQuery,
  options: { checkIntervalMs?: number; signal?: AbortSignal } = {},
): AsyncGenerator<LogTailEvent, void, unknown> {
  const checkIntervalMs = options.checkIntervalMs || 400;
  const signal = options.signal;

  let targetFile = query.file;
  if (!targetFile) {
    const allFiles = await listLogFiles(logsDir);
    if (allFiles.length === 0) {
      yield { type: 'error', message: 'No log files available to tail' };
      return;
    }
    targetFile = allFiles[0].name;
  }

  const filePath = getSafeLogFilePath(targetFile);
  if (!existsSync(filePath)) {
    yield { type: 'error', message: `Log file ${targetFile} not found` };
    return;
  }

  let currentOffset = 0;
  try {
    const initialStats = await fsPromises.stat(filePath);
    currentOffset = initialStats.size;
  } catch {
    currentOffset = 0;
  }

  const filterLevels = query.levels ? compact(query.levels.split(',').map((l) => l.trim().toLowerCase())) : null;
  const searchKeyword = query.search ? query.search.trim().toLowerCase() : null;

  let lineIndex = 0;
  let lastHeartbeat = Date.now();

  while (!signal?.aborted) {
    await delay(checkIntervalMs);
    if (signal?.aborted) break;

    try {
      if (!existsSync(filePath)) {
        // 文件可能正在被 pino-roll 切割轮转，短暂等待不直接崩溃
        continue;
      }
      const stats = await fsPromises.stat(filePath);

      if (stats.size > currentOffset) {
        const readLen = stats.size - currentOffset;
        const fd = await fsPromises.open(filePath, 'r');
        let buffer: Buffer;
        try {
          buffer = Buffer.alloc(readLen);
          await fd.read(buffer, 0, readLen, currentOffset);
        } finally {
          await fd.close();
        }

        currentOffset = stats.size;
        const text = buffer.toString('utf8');
        const lines = text.split(/\r?\n/);

        for (const line of lines) {
          if (!line.trim()) continue;
          lineIndex++;
          const entry = parseLogLine(line, targetFile, lineIndex);

          if (!matchesFilters(entry, filterLevels, searchKeyword)) {
            continue;
          }

          yield { type: 'entry', entry };
        }
      } else if (stats.size < currentOffset) {
        // 文件被截断清空或轮转重建
        currentOffset = 0;
        lineIndex = 0;
      }

      // 每 15 秒输出一次心跳保活
      if (Date.now() - lastHeartbeat >= 15000) {
        lastHeartbeat = Date.now();
        yield { type: 'heartbeat', timestamp: lastHeartbeat };
      }
    } catch (err) {
      // 捕获瞬时 ENOENT / EBUSY 异常，若未终止则降级恢复
      if (!signal?.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('ENOENT')) {
          yield { type: 'error', message };
          break;
        }
      }
    }
  }
}
