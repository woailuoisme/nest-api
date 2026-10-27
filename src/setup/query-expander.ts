/**
 * Spatie / JSON:API 风格查询串展开器。
 *
 * Fastify 内置解析器（fast-querystring）只做扁平解析：`filter[name]=John` 到达应用层时
 * 键名是字面量 `filter[name]`。Zod `@Query({ schema })` 以 `filter` 为键做校验，
 * 因此需要在适配器层把 `filter[field]` / `fields[resource]` 展开为嵌套对象，
 * 其余参数保持扁平不变。
 *
 * 重复键按 Laravel（`parse_str`）语义取最后一个；多值统一走逗号语法（`filter[id]=1,2,3`）。
 */

/** 允许展开的参数前缀（白名单，避免误伤业务参数） */
const EXPANDABLE_PREFIXES = new Set(['filter', 'fields']);
/** `prefix[segment]` 形态；仅允许一层，拒绝 `filter[a][b]` 这类深层嵌套 */
const BRACKET_KEY_PATTERN = /^([A-Za-z]+)\[([A-Za-z0-9_]{1,64})\]$/;
/** 原型链敏感键 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * 将 `prefix[segment]` 形态的扁平键展开为嵌套对象。
 *
 * - `filter[name]=John` → `{ filter: { name: 'John' } }`
 * - `fields[users]=id,name` → `{ fields: { users: 'id,name' } }`
 * - 其他键（`page`、`sort`、`include`…）原样保留
 * - 未在白名单内的 `a[b]` 同样原样保留，交由下游处理
 */
export function expandBracketKeys(flat: Record<string, string | string[]>): Record<string, unknown> {
  const expanded: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(flat)) {
    const matched = BRACKET_KEY_PATTERN.exec(key);
    const prefix = matched?.[1];
    const segment = matched?.[2];

    if (prefix && segment && EXPANDABLE_PREFIXES.has(prefix)) {
      // 敏感段名直接丢弃：既不展开也不落为字面键，避免下游误用
      if (FORBIDDEN_KEYS.has(segment)) continue;

      // 同名标量参数已存在（`?filter=x&filter[role]=ADMIN`）时保留标量，交由 DTO 校验拒绝
      const existing = expanded[prefix];
      if (existing !== undefined && (typeof existing !== 'object' || existing === null)) continue;

      // 重复键取最后一个值（与 Laravel parse_str 一致）
      const lastValue = Array.isArray(value) ? value[value.length - 1] : value;
      const bucket = (existing ?? (expanded[prefix] = {})) as Record<string, string | undefined>;
      bucket[segment] = lastValue ?? '';
      continue;
    }

    if (FORBIDDEN_KEYS.has(key)) continue;
    // 同名标量键不得覆盖已展开的对象（`?filter[role]=ADMIN&filter=x`）
    if (EXPANDABLE_PREFIXES.has(key) && typeof expanded[key] === 'object' && expanded[key] !== null) continue;
    expanded[key] = value;
  }

  return expanded;
}

/**
 * Fastify `querystringParser` 实现：扁平解析 + 括号键展开。
 *
 * 使用 Node 内置 `URLSearchParams`（零依赖），并保留重复键以便按 Laravel 语义取末值。
 * 单次解析实测约 2.1µs（Fastify 默认 fast-querystring 约 0.7µs），相对业务链路可忽略，
 * 因此不为解析性能再引入直接依赖。
 */
export function parseSpatieQuerystring(input: string): Record<string, unknown> {
  const flat: Record<string, string | string[]> = {};

  for (const [key, value] of new URLSearchParams(input)) {
    if (FORBIDDEN_KEYS.has(key)) continue;

    const existing = flat[key];
    if (existing === undefined) {
      flat[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      flat[key] = [existing, value];
    }
  }

  return expandBracketKeys(flat);
}
