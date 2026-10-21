/**
 * 将 Query String `?token=<session>` 归一化为 `Authorization: Bearer` 头。
 *
 * 供 EventSource / 无法自定义请求头的移动端场景使用；请求已带 Authorization 时不覆盖。
 * 全局鉴权守卫与 /uploads 私有文件鉴权共用，避免两条鉴权路径的取值方式出现分歧。
 */
export function applyQueryTokenAsBearer(headers: Headers, query?: { token?: unknown }): void {
  const token = query?.token;
  if (typeof token !== 'string' || headers.has('authorization')) return;
  headers.set('authorization', `Bearer ${token.trim()}`);
}
