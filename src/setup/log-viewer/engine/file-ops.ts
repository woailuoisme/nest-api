import { existsSync, promises as fsPromises } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { orderBy } from 'es-toolkit';
import { PATHS } from '@/common/constants/app.constants';
import { formatBytes, type LogFileInfo } from '../constants';

/**
 * 获取经过安全校验的文件绝对路径（防止路径遍历攻击）
 */
export function getSafeLogFilePath(filename: string): string {
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Path traversal detected');
  }

  const safeName = basename(filename);
  if (!safeName.endsWith('.log')) {
    throw new Error('Invalid log file extension');
  }

  const logsDir = resolve(process.cwd(), PATHS.STORAGE_LOGS);
  const fullPath = join(logsDir, safeName);
  if (!fullPath.startsWith(logsDir)) {
    throw new Error('Path traversal detected');
  }

  return fullPath;
}

/**
 * 列出所有日志文件并按修改时间倒序排列
 */
export async function listLogFiles(logsDir = resolve(process.cwd(), PATHS.STORAGE_LOGS)): Promise<LogFileInfo[]> {
  if (!existsSync(logsDir)) {
    await fsPromises.mkdir(logsDir, { recursive: true });
    return [];
  }

  const entries = await fsPromises.readdir(logsDir);
  const logFiles: LogFileInfo[] = [];

  for (const file of entries) {
    if (!file.endsWith('.log')) continue;
    const filePath = join(logsDir, file);
    try {
      const stats = await fsPromises.stat(filePath);
      logFiles.push({
        name: file,
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        mtime: stats.mtime.toISOString(),
        mtimeMs: stats.mtimeMs,
      });
    } catch {
      // 容错：文件在遍历时被轮转删除
    }
  }

  return orderBy(logFiles, ['mtimeMs'], ['desc']);
}
