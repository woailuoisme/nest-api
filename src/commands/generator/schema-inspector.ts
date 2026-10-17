import { readFileSync } from 'node:fs';

import { DRIZZLE_TO_FIELD_TYPE, SYSTEM_FIELDS } from './field-mappings';
import type { FieldDef } from './types';

/** 词法扫描状态 — 追踪字符串与注释上下文 */
interface ScanState {
  inString: boolean;
  stringChar: string;
  escapeNext: boolean;
  inLineComment: boolean;
  inBlockComment: boolean;
}

/** 初始扫描状态 */
function createScanState(): ScanState {
  return { inString: false, stringChar: '', escapeNext: false, inLineComment: false, inBlockComment: false };
}

/**
 * 推进注释状态机。
 * @returns true 表示该字符已被注释上下文消费，调用方应跳过结构分析
 */
function scanCommentChar(ch: string, nextCh: string, s: ScanState): boolean {
  if (s.inLineComment) {
    if (ch === '\n') s.inLineComment = false;
    return true;
  }
  if (s.inBlockComment) {
    if (ch === '*' && nextCh === '/') s.inBlockComment = false;
    return true;
  }
  if (ch === '/' && nextCh === '/') {
    s.inLineComment = true;
    return true;
  }
  if (ch === '/' && nextCh === '*') {
    s.inBlockComment = true;
    return true;
  }
  return false;
}

/**
 * 推进字符串字面量状态机。
 * @returns true 表示该字符属于字符串上下文，调用方应跳过结构分析
 */
function scanStringChar(ch: string, s: ScanState): boolean {
  if (!s.inString) {
    if (ch === "'" || ch === '"' || ch === '`') {
      s.inString = true;
      s.stringChar = ch;
      return true;
    }
    return false;
  }
  if (s.escapeNext) {
    s.escapeNext = false; // 被转义字符直接消费
    return true;
  }
  if (ch === '\\') {
    s.escapeNext = true;
  } else if (ch === s.stringChar) {
    s.inString = false;
  }
  return true;
}

/**
 * Drizzle Schema 反解与结构探测器
 */
export const SchemaInspector = {
  /**
   * 从 Drizzle schema 源文件中解析指定表的字段定义。
   */
  parseSchemaFields(schemaPath: string, tableName: string): { errors: string[]; fieldDefs: FieldDef[] | null } {
    const errors: string[] = [];

    // 1. 读取 schema 源文件
    let source: string;
    try {
      source = readFileSync(schemaPath, 'utf8');
    } catch {
      return { errors: [`Schema 文件不存在: ${schemaPath}`], fieldDefs: null };
    }

    // 2. 定位 pgTable 块起始
    const escapedName = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tableRegex = new RegExp(`export\\s+const\\s+${escapedName}\\s*=\\s*pgTable\\s*\\(`, 'm');
    const tableMatch = tableRegex.exec(source);

    if (!tableMatch) {
      return { errors: [`在 schema 文件中未找到表定义: ${tableName}`], fieldDefs: null };
    }

    // 3. 提取 { ... } 块内容（处理跨行定义）
    const blockContent = SchemaInspector.extractBlock(source, tableMatch.index + tableMatch[0].length);
    if (blockContent === null) {
      return { errors: [`无法解析 pgTable 块: ${tableName}`], fieldDefs: null };
    }

    // 4. 逐行解析字段
    const fieldDefs = SchemaInspector.parseFieldLines(blockContent, errors);

    if (fieldDefs.length === 0 && errors.length === 0) {
      return { errors: [`表 ${tableName} 中没有可解析的业务字段（已跳过系统字段）`], fieldDefs: null };
    }

    return { errors, fieldDefs: errors.length === 0 ? fieldDefs : null };
  },

  /**
   * 从 pgTable('name', 之后的源代码中找到 { } 块并提取内容。
   */
  extractBlock(source: string, startPos: number): string | null {
    const braceStart = source.indexOf('{', startPos);
    if (braceStart === -1) return null;

    const state = createScanState();
    let depth = 0;

    for (let i = braceStart; i < source.length; i++) {
      const ch = source[i];
      const nextCh = source[i + 1] ?? '';

      if (scanCommentChar(ch, nextCh, state)) continue;
      if (scanStringChar(ch, state)) continue;

      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return source.slice(braceStart + 1, i);
        }
      }
    }

    return null;
  },

  /**
   * 将 pgTable 块内容规范化为单行字段列表，然后逐行解析。
   */
  parseFieldLines(blockContent: string, errors: string[]): FieldDef[] {
    const fieldDefs: FieldDef[] = [];
    const normalized = SchemaInspector.normalizeLines(blockContent);

    let pendingComment = '';

    for (const line of normalized) {
      // 1. 独立 JSDoc 或三斜杠注释行 → 缓存为下个字段的描述
      const jsdocMatch = line.match(/^\s*\/\*\*\s*(.*?)\s*\*\/\s*$/);
      const tripleMatch = line.match(/^\s*\/\/\/\s*(.*)\s*$/);

      if (jsdocMatch || tripleMatch) {
        const commentText = (jsdocMatch?.[1] ?? tripleMatch?.[1] ?? '').trim();
        if (commentText && !commentText.startsWith('@')) {
          pendingComment = commentText;
        }
        continue;
      }

      // 2. 尝试匹配字段定义: fieldName: drizzleType('dbColName' ...
      const fieldMatch = line.match(/^\s*(\w+)\s*:\s*(\w+)\s*\(\s*['"]([^'"]*)['"]/);
      if (!fieldMatch) continue;

      const [, fieldName, drizzleType] = fieldMatch;

      // 3. 跳过系统字段
      if (SYSTEM_FIELDS.has(fieldName)) {
        pendingComment = '';
        continue;
      }

      // 4. 映射 Drizzle 类型 → FieldType
      const fieldType = DRIZZLE_TO_FIELD_TYPE[drizzleType];
      if (!fieldType) {
        errors.push(`无法识别的 Drizzle 类型: ${drizzleType} (字段: ${fieldName})`);
        pendingComment = '';
        continue;
      }

      // 5. 从行尾提取普通行注释作为补充描述
      const tailComment = line.match(/\/\/\s*(.*?)\s*$/);
      const description = pendingComment || tailComment?.[1] || undefined;

      // 6. 判定 required：有 .notNull() 且无 .default*() 为必填
      const hasNotNull = /\.notNull\s*\(/.test(line);
      const hasDefault = /\.default\s*\(/.test(line);
      const required = hasNotNull && !hasDefault;

      fieldDefs.push({
        name: fieldName,
        type: fieldType,
        description,
        required,
      });

      pendingComment = '';
    }

    return fieldDefs;
  },

  /**
   * 将块内容按行规范化为独立字段行。
   */
  normalizeLines(blockContent: string): string[] {
    const rawLines = blockContent.split('\n');
    const result: string[] = [];
    let current = '';

    for (const line of rawLines) {
      const trimmed = line.trim();

      if (!trimmed) {
        if (current) {
          result.push(current);
          current = '';
        }
        continue;
      }

      if (/^\s*(?:\/\*\*|(?:\/\/\/?))/.test(trimmed) && !current) {
        result.push(line);
        continue;
      }

      current = current ? `${current} ${trimmed}` : line;

      if (SchemaInspector.isBalanced(current)) {
        result.push(current);
        current = '';
      }
    }

    if (current) result.push(current);
    return result;
  },

  /** 检查字符串中圆括号是否平衡（忽略引号内容） */
  isBalanced(line: string): boolean {
    const state = createScanState();
    let depth = 0;

    for (let i = 0; i < line.length; i++) {
      if (scanStringChar(line[i], state)) continue;
      if (line[i] === '(') depth++;
      else if (line[i] === ')') depth--;
    }

    return depth === 0;
  },
};
