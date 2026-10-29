/**
 * DDL 漂移守卫：`src/database/drizzle/sql/*.sql` 与 drizzle schema 必须逐表逐列一致。
 *
 * 该目录在 AGENTS 中被声明为「与 Schema 严格对齐的纯净 DDL」，供快速建库 / 容器初始化 / DBA 审计，
 * 但此前没有任何自动化校验：本次改造中 `jsonb → json`、`otp_codes` 唯一索引、
 * `otp_send_windows` 都必须手工同步两处，漏改一次就会让两条建库路径分叉。
 *
 * 本用例以 drizzle 运行时元数据（`getTableConfig`）为准，比对表名、列名、索引名。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from '@/database/drizzle/schema';

const SQL_DIR = join(process.cwd(), 'src/database/drizzle/sql');

/** 读取全部 DDL 文件（去掉 psql 专有的 `\ir` 包含指令，各文件本身按序号排列） */
function loadDdl(): string {
  return readdirSync(SQL_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(join(SQL_DIR, file), 'utf8'))
    .join('\n')
    .replace(/^\\ir\s+.*$/gm, '');
}

/** 解析 `CREATE TABLE` 的列名（`CONSTRAINT` 行不算列） */
function parseDdlColumns(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();

  for (const matched of sql.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)" \(([\s\S]*?)\n\);/g)) {
    const [, table, body] = matched;
    const columns = new Set<string>();
    for (const line of body.split('\n')) {
      const column = /^\s{4}"(\w+)"/.exec(line);
      if (column) columns.add(column[1]);
    }
    tables.set(table, columns);
  }

  return tables;
}

/** 解析 `CREATE [UNIQUE] INDEX` 的索引名 */
function parseDdlIndexes(sql: string): Set<string> {
  const indexes = new Set<string>();
  for (const matched of sql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "(\w+)"/g)) {
    indexes.add(matched[1]);
  }
  return indexes;
}

/** 汇总 drizzle schema 的表 / 列 / 索引（非表导出会被 `getTableConfig` 拒绝，忽略即可） */
function collectSchema() {
  const tables = new Map<string, Set<string>>();
  const indexes = new Set<string>();

  for (const value of Object.values(schema)) {
    try {
      const config = getTableConfig(value as never);
      if (!config?.name || !Array.isArray(config.columns) || config.columns.length === 0) continue;

      tables.set(config.name, new Set(config.columns.map((column) => column.name)));
      for (const index of config.indexes) {
        if (index.config.name) indexes.add(index.config.name);
      }
    } catch {
      // 非表导出（类型、常量、Zod schema 等）直接跳过
    }
  }

  return { tables, indexes };
}

const ddl = loadDdl();
const ddlTables = parseDdlColumns(ddl);
const ddlIndexes = parseDdlIndexes(ddl);
const { tables: schemaTables, indexes: schemaIndexes } = collectSchema();

describe('SQL DDL 与 drizzle schema 对齐', () => {
  it('每个 schema 表都应在 DDL 中定义', () => {
    const missing = [...schemaTables.keys()].filter((table) => !ddlTables.has(table));

    expect(missing).toEqual([]);
  });

  it('每张表的列集合应完全一致', () => {
    const diffs: string[] = [];

    for (const [table, columns] of schemaTables) {
      const ddlColumns = ddlTables.get(table);
      if (!ddlColumns) continue;

      const missingInDdl = [...columns].filter((column) => !ddlColumns.has(column));
      const extraInDdl = [...ddlColumns].filter((column) => !columns.has(column));
      if (missingInDdl.length > 0) diffs.push(`${table} 缺少列: ${missingInDdl.join(', ')}`);
      if (extraInDdl.length > 0) diffs.push(`${table} 多余列: ${extraInDdl.join(', ')}`);
    }

    expect(diffs).toEqual([]);
  });

  it('索引名集合应完全一致', () => {
    expect([...ddlIndexes].sort()).toEqual([...schemaIndexes].sort());
  });

  it('幂等表 response 列必须是 json（jsonb 会拒绝含 \\u0000 的响应体）', () => {
    expect(ddl).toMatch(/"response" json,/);
    expect(ddl).not.toMatch(/"response" jsonb/);
  });
});
