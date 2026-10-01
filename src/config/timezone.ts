/**
 * 全局时区工具 — 统一进程时区（默认东八区 Asia/Shanghai）。
 * 在 Nest 应用创建前调用，使日志时间戳、定时任务均按配置时区工作。
 */

/** 默认 IANA 时区（东八区） */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** 校验是否为合法 IANA 时区 */
export function isTimezoneValid(timezone: string): boolean {
  return Intl.supportedValuesOf('timeZone').includes(timezone);
}

/**
 * 设置进程时区。
 * 直接从 process.env 读取 APP_TIMEZONE（入口在 load .env 之后、NestFactory 之前调用），
 * 未配置或非法时回退默认时区。
 */
export function setupTimezone(): string {
  const configured = process.env.APP_TIMEZONE;
  const timezone = configured && isTimezoneValid(configured) ? configured : DEFAULT_TIMEZONE;

  process.env.TZ = timezone;

  // 触发 Intl 内部时区缓存刷新（Node 对 process.env.TZ 变更的缓存策略）：
  // 构造 + 解析本身即副作用，无需再取 timeZone 值
  try {
    new Intl.DateTimeFormat().resolvedOptions();
  } catch {
    // 平台不支持时忽略
  }

  return timezone;
}
