/**
 * 拼接查询串（`undefined` 字段自动剔除）
 *
 * 用于构造出站请求 URL。之所以收敛为单一实现：微信支付等平台的**待签名 URL 必须与真正发出
 * 的 URL 逐字节一致**，各驱动各写一份时，任何一处编码或顺序差异都会表现为「签名错误」，
 * 且极难定位。
 *
 * @example
 * buildQueryString({ mchid: '1900000001', bill_type: undefined }) // -> '?mchid=1900000001'
 */
export function buildQueryString(query?: Record<string, string | undefined>): string {
  const entries = Object.entries(query ?? {}).filter(([, value]) => value !== undefined) as [string, string][];
  if (entries.length === 0) {
    return '';
  }
  return `?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`;
}
