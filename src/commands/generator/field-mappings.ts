import type { FieldDef, FieldType } from './types';

// ─── Drizzle 列类型映射 ─────────────────────────────────

interface FieldTypeConfig {
  drizzle: string; // 含 %s 占位符的 Drizzle 列定义
  tsType: string;
  mock: string;
}

export const FIELD_TYPE_MAP: Record<FieldType, FieldTypeConfig> = {
  string: { drizzle: "varchar('%s', { length: 255 }).notNull()", tsType: 'string', mock: "'example'" },
  email: { drizzle: "varchar('%s', { length: 255 }).notNull()", tsType: 'string', mock: "'test@example.com'" },
  number: { drizzle: "integer('%s').notNull()", tsType: 'number', mock: '1' },
  float: { drizzle: "real('%s').notNull()", tsType: 'number', mock: '1.0' },
  boolean: { drizzle: "boolean('%s').notNull().default(false)", tsType: 'boolean', mock: 'false' },
  text: { drizzle: "text('%s').notNull()", tsType: 'string', mock: "'some description'" },
  date: {
    drizzle: "timestamp('%s', { withTimezone: true }).notNull()",
    tsType: 'Date',
    mock: "new Date('2024-01-01')",
  },
};

// ─── Zod 校验器映射 ─────────────────────────────────────

export const CREATE_ZOD_VALIDATORS: Record<FieldType, string> = {
  string: 'z.string().trim().min(1)',
  email: 'z.string().email().toLowerCase().trim()',
  number: 'z.coerce.number().int().min(1)',
  float: 'z.coerce.number()',
  boolean: 'z.boolean()',
  text: 'z.string()',
  date: 'z.coerce.date()',
};

export const FILTER_ZOD_VALIDATORS: Record<FieldType, string> = {
  string: 'z.string().optional()',
  email: 'z.string().email().optional()',
  number: 'z.coerce.number().int().optional()',
  float: 'z.coerce.number().optional()',
  boolean: 'z.boolean().optional()',
  text: 'z.string().optional()',
  date: 'z.coerce.date().optional()',
};

/**
 * 响应资源 schema 校验器：仅表达输出类型（不含 min/max 等输入约束）。
 *
 * 输出契约用于运行时白名单裁剪与 OpenAPI 文档，若复用输入的强约束会把合法数据判为非法（如非正值数值）。
 */
export const RESPONSE_ZOD_VALIDATORS: Record<FieldType, string> = {
  string: 'z.string()',
  email: 'z.string()',
  number: 'z.number().int()',
  float: 'z.number()',
  boolean: 'z.boolean()',
  text: 'z.string()',
  date: 'z.date()',
};

// ─── 类型判断辅助 ───────────────────────────────────────

const VARCHAR_TYPES = new Set<FieldType>(['string', 'email']);
const INTEGER_TYPES = new Set<FieldType>(['number']);
const REAL_TYPES = new Set<FieldType>(['float']);
const TEXT_TYPES = new Set<FieldType>(['text']);
const BOOLEAN_TYPES = new Set<FieldType>(['boolean']);
const TIMESTAMP_TYPES = new Set<FieldType>(['date']);
const SEARCHABLE_TYPES = new Set<FieldType>(['string', 'email', 'text']);

/** 检测字段定义列表中是否包含指定类型的字段 */
export function hasType(fields: FieldDef[], types: Set<FieldType>): boolean {
  return fields.some((f) => types.has(f.type));
}

export { BOOLEAN_TYPES, INTEGER_TYPES, REAL_TYPES, SEARCHABLE_TYPES, TEXT_TYPES, TIMESTAMP_TYPES, VARCHAR_TYPES };

// ─── Drizzle 列类型 → FieldType 反向映射 ─────────────────

/** 从 Drizzle schema 文件解析字段时，将 Drizzle 列构建器名映射回 FieldType */
export const DRIZZLE_TO_FIELD_TYPE: Record<string, FieldType> = {
  // ── 字符串类 ──
  varchar: 'string',
  char: 'string',
  text: 'text',
  uuid: 'string',

  // ── 整数类 ──
  integer: 'number',
  int: 'number', // SQLite 别名
  smallint: 'number',
  bigint: 'number',
  serial: 'number',
  smallserial: 'number',
  bigserial: 'number',

  // ── 浮点类 ──
  real: 'float',
  doublePrecision: 'float', // Drizzle 函数名是 camelCase
  numeric: 'float',
  // decimal 无独立构建器，由 numeric 统一处理

  // ── 布尔类 ──
  boolean: 'boolean',

  // ── 日期/时间类 ──
  timestamp: 'date',
  date: 'date',
  time: 'string',
  interval: 'string',

  // ── JSON 类 ──
  json: 'text',
  jsonb: 'text',

  // ── 网络地址类 ──
  inet: 'string',
  cidr: 'string',
  macaddr: 'string',
  macaddr8: 'string',

  // ── 几何类（存储为文本） ──
  point: 'text',
  line: 'text',

  // ── pgvector 向量类（文本序列化） ──
  vector: 'text',
  halfvec: 'text',
  sparsevec: 'text',
  bit: 'text',

  // ── PostGIS 空间类（文本序列化） ──
  geometry: 'text',

  // ── SQLite 专用 ──
  blob: 'text',
};

/** 系统字段 — 模板自动生成，解析 schema 时跳过 */
export const SYSTEM_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt']);
