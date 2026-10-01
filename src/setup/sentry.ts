/**
 * Sentry / GlitchTip 初始化（副作用模块）
 *
 * ESM 的 import 会被提升到模块顶部执行，因此只能靠「最先被 import」来保证 SDK 早于其他模块初始化：
 * 各入口（main / worker / cli）必须在 `import 'dotenv/config'` 之后、其余 import 之前导入本模块。
 *
 * 未配置 SENTRY_DSN 时不初始化：本地与测试环境零配置可用，日志桥接也随之退化为空操作。
 */
import { inspect } from 'node:util';
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.01, // 1% 事务采样
    // 注：v11 已移除 session 相关概念（无 autoSessionTracking 选项），GlitchTip 不支持 sessions 的顾虑随之不存在
  });
}

/**
 * 将 Pino 的 error/fatal 级日志上报到 Sentry
 *
 * 首个参数为 Error 时按异常上报（保留堆栈），否则按消息上报；Sentry 未初始化时为空操作。
 * 消息拼接使用 `util.inspect` 而非 JSON 序列化：日志参数可能含循环引用，JSON.stringify 会抛错并打断日志写入。
 */
export function captureLog(args: unknown[]): void {
  if (!Sentry.getClient()) {
    return;
  }

  const [first, ...rest] = args;

  if (first instanceof Error) {
    Sentry.captureException(first, rest.length > 0 ? { extra: { details: rest } } : undefined);
    return;
  }

  const message = args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg))).join(' ');
  Sentry.captureMessage(message, 'error');
}
