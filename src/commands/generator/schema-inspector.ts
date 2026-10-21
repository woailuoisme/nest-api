import { readFileSync } from 'node:fs';

import { DRIZZLE_TO_FIELD_TYPE, SYSTEM_FIELDS } from './field-mappings';
import type { FieldDef } from './types';

/** Lexer scan state — tracks string and comment context */
interface ScanState {
  inString: boolean;
  stringChar: string;
  escapeNext: boolean;
  inLineComment: boolean;
  inBlockComment: boolean;
}

/** Initial scan state */
function createScanState(): ScanState {
  return { inString: false, stringChar: '', escapeNext: false, inLineComment: false, inBlockComment: false };
}

/**
 * Advance the comment state machine.
 * @returns true when the character was consumed as comment context; callers must skip structural analysis
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
 * Advance the string-literal state machine.
 * @returns true when the character belongs to string context; callers must skip structural analysis
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
    s.escapeNext = false; // escaped character consumed as-is
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
 * Drizzle schema parser and structure detector
 */
export const SchemaInspector = {
  /**
   * Parse field definitions of the given table from a Drizzle schema source file.
   */
  parseSchemaFields(schemaPath: string, tableName: string): { errors: string[]; fieldDefs: FieldDef[] | null } {
    const errors: string[] = [];

    // 1. Read the schema source file
    let source: string;
    try {
      source = readFileSync(schemaPath, 'utf8');
    } catch {
      return { errors: [`Schema file not found: ${schemaPath}`], fieldDefs: null };
    }

    // 2. Locate the pgTable block start
    const escapedName = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tableRegex = new RegExp(`export\\s+const\\s+${escapedName}\\s*=\\s*pgTable\\s*\\(`, 'm');
    const tableMatch = tableRegex.exec(source);

    if (!tableMatch) {
      return { errors: [`Table definition not found in schema file: ${tableName}`], fieldDefs: null };
    }

    // 3. Extract the { ... } block content (handles multi-line definitions)
    const blockContent = SchemaInspector.extractBlock(source, tableMatch.index + tableMatch[0].length);
    if (blockContent === null) {
      return { errors: [`Unable to parse the pgTable block: ${tableName}`], fieldDefs: null };
    }

    // 4. Parse fields line by line
    const fieldDefs = SchemaInspector.parseFieldLines(blockContent, errors);

    if (fieldDefs.length === 0 && errors.length === 0) {
      return { errors: [`No parsable business fields in table ${tableName} (system fields skipped)`], fieldDefs: null };
    }

    return { errors, fieldDefs: errors.length === 0 ? fieldDefs : null };
  },

  /**
   * Find and extract the { } block following pgTable('name'.
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
   * Normalize the pgTable block into single-line field entries, then parse line by line.
   */
  parseFieldLines(blockContent: string, errors: string[]): FieldDef[] {
    const fieldDefs: FieldDef[] = [];
    const normalized = SchemaInspector.normalizeLines(blockContent);

    let pendingComment = '';

    for (const line of normalized) {
      // 1. Standalone JSDoc or triple-slash comment line -> cached as the next field description
      const jsdocMatch = line.match(/^\s*\/\*\*\s*(.*?)\s*\*\/\s*$/);
      const tripleMatch = line.match(/^\s*\/\/\/\s*(.*)\s*$/);

      if (jsdocMatch || tripleMatch) {
        const commentText = (jsdocMatch?.[1] ?? tripleMatch?.[1] ?? '').trim();
        if (commentText && !commentText.startsWith('@')) {
          pendingComment = commentText;
        }
        continue;
      }

      // 2. Try to match a field definition: fieldName: drizzleType('dbColName' ...
      const fieldMatch = line.match(/^\s*(\w+)\s*:\s*(\w+)\s*\(\s*['"]([^'"]*)['"]/);
      if (!fieldMatch) continue;

      const [, fieldName, drizzleType] = fieldMatch;

      // 3. Skip system fields
      if (SYSTEM_FIELDS.has(fieldName)) {
        pendingComment = '';
        continue;
      }

      // 4. Map the Drizzle type to a FieldType
      const fieldType = DRIZZLE_TO_FIELD_TYPE[drizzleType];
      if (!fieldType) {
        errors.push(`Unrecognized Drizzle type: ${drizzleType} (field: ${fieldName})`);
        pendingComment = '';
        continue;
      }

      // 5. Extract a trailing line comment as a supplementary description
      const tailComment = line.match(/\/\/\s*(.*?)\s*$/);
      const description = pendingComment || tailComment?.[1] || undefined;

      // 6. Required = has .notNull() and no .default*()
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
   * Normalize block content into independent field lines.
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

  /** Check whether parentheses in the string are balanced (string contents ignored) */
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
