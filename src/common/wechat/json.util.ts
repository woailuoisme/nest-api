/**
 * 安全解析微信接口应答的 JSON 文本。
 *
 * 微信网关异常时会返回 HTML / 纯文本，直接 `JSON.parse` 抛出的非业务异常会覆盖真实错误码，
 * 故解析失败或结果非对象时统一返回 null，由调用方按「无法解析的应答」降级处理。
 */
export function safeParseJson<T>(raw: string): T | null {
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
