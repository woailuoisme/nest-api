import { LEVEL_MAP, type ParsedLogEntry } from '../constants';

/**
 * 校验单行日志是否匹配关键词搜索
 */
export function matchesSearch(raw: Record<string, unknown>, keyword: string): boolean {
  const msg = String(raw.msg || raw.message || '').toLowerCase();
  const context = raw.context ? String(raw.context).toLowerCase() : '';
  const reqId = String(raw.reqId || (raw.req as { id?: string })?.id || '').toLowerCase();
  const stack = String((raw.err as { stack?: string })?.stack || raw.stack || '').toLowerCase();
  const url = String((raw.req as { url?: string })?.url || '').toLowerCase();

  return (
    msg.includes(keyword) ||
    context.includes(keyword) ||
    reqId.includes(keyword) ||
    stack.includes(keyword) ||
    url.includes(keyword)
  );
}

/**
 * 校验日志条目是否符合级别与全文检索过滤条件
 */
export function matchesFilters(
  entry: ParsedLogEntry,
  filterLevels: string[] | null,
  searchKeyword: string | null,
): boolean {
  if (filterLevels && filterLevels.length > 0 && !filterLevels.includes(entry.level)) {
    return false;
  }
  if (searchKeyword && !matchesSearch(entry.raw, searchKeyword)) {
    return false;
  }
  return true;
}

/**
 * 解析单行日志为结构化 ParsedLogEntry
 */
export function parseLogLine(line: string, targetFile: string, lineIndex: number): ParsedLogEntry {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const levelNumber = typeof raw.level === 'number' ? raw.level : 30;
    const levelName = LEVEL_MAP[levelNumber] || 'info';

    const reqObj = raw.req as ParsedLogEntry['req'];
    const resObj = raw.res as ParsedLogEntry['res'];
    const errObj = raw.err as ParsedLogEntry['err'];
    const reqId = raw.reqId || reqObj?.id || (reqObj?.headers ? (reqObj.headers['x-request-id'] as string) : undefined);

    const timeVal = typeof raw.time === 'number' ? raw.time : Date.now();
    const dateObj = new Date(timeVal);
    const timestamp = !Number.isNaN(dateObj.getTime())
      ? dateObj.toISOString().replace('T', ' ').substring(0, 19)
      : String(timeVal);

    return {
      id: `${targetFile}-${lineIndex}`,
      levelNumber,
      level: levelName,
      time: timeVal,
      timestamp,
      context: raw.context ? String(raw.context) : undefined,
      msg: String(raw.msg || raw.message || ''),
      pid: typeof raw.pid === 'number' ? raw.pid : undefined,
      hostname: raw.hostname ? String(raw.hostname) : undefined,
      reqId: reqId ? String(reqId) : undefined,
      req: reqObj,
      res: resObj,
      responseTime: typeof raw.responseTime === 'number' ? raw.responseTime : undefined,
      err: errObj,
      stack: errObj?.stack || (raw.stack ? String(raw.stack) : undefined),
      raw,
    };
  } catch {
    // 非 JSON 行降级为纯文本 log 包装
    return {
      id: `${targetFile}-${lineIndex}`,
      levelNumber: 30,
      level: 'info',
      time: Date.now(),
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      msg: line,
      raw: { msg: line },
    };
  }
}
