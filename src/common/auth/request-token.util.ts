/**
 * 将 Query String `?token=<jwt>` 归一化为 `Authorization: Bearer` 头。
 *
 * 供 EventSource / 无法自定义请求头的移动端场景使用；请求已带 Authorization 时不覆盖。
 * 私有 `/uploads/*` 鉴权 Hook 使用，避免「Cookie / Bearer / query token」三条取值路径分叉。
 */
export function applyQueryTokenAsBearer(
  headers: Record<string, string | string[] | undefined>,
  query?: { token?: unknown },
): void {
  const token = query?.token;
  if (typeof token !== 'string' || headers.authorization) return;
  headers.authorization = `Bearer ${token.trim()}`;
}
