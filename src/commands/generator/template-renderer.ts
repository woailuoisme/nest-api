import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Handlebars from 'handlebars';
import {
  BOOLEAN_TYPES,
  CREATE_ZOD_VALIDATORS,
  FIELD_TYPE_MAP,
  FILTER_ZOD_VALIDATORS,
  hasType,
  INTEGER_TYPES,
  REAL_TYPES,
  SEARCHABLE_TYPES,
  TEXT_TYPES,
  TIMESTAMP_TYPES,
  VARCHAR_TYPES,
} from './field-mappings';
import { buildApiProperty, escapeTsString, pluralize, toCamelCase, toPascalCase, toSnakeCase } from './string.utils';
import type { FieldDef, FieldType, ModuleScope, TemplateContext, TemplateField } from './types';

// ─── Handlebars Helper 幂等注册 ─────────────────────────

Handlebars.registerHelper('PascalCase', (str: string) => {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
});

Handlebars.registerHelper('or', (...args: unknown[]) => {
  return args.slice(0, -1).some(Boolean);
});

Handlebars.registerHelper('and', (...args: unknown[]) => {
  return args.slice(0, -1).every(Boolean);
});

export interface TemplateEntry {
  template: string;
  output: (ctx: TemplateContext) => string;
}

export const TEMPLATE_FILES: TemplateEntry[] = [
  {
    template: 'table.hbs',
    output: (ctx) => `src/database/drizzle/schema/${ctx.featureName}.schema.ts`,
  },
  {
    template: 'dto.hbs',
    output: (ctx) => `src/${ctx.featureModulePath}/${ctx.featureName}.dto.ts`,
  },
  {
    template: 'service.hbs',
    output: (ctx) => `src/${ctx.featureModulePath}/${ctx.featureName}.service.ts`,
  },
  {
    template: 'controller.hbs',
    output: (ctx) => `src/${ctx.featureModulePath}/${ctx.featureName}.controller.ts`,
  },
  {
    template: 'module.hbs',
    output: (ctx) => `src/${ctx.featureModulePath}/${ctx.featureName}.module.ts`,
  },
  {
    template: 'test.hbs',
    output: (ctx) => `tests/unit/${ctx.featureModulePath}/${ctx.featureName}.service.test.ts`,
  },
];

export interface RenderedArtifact {
  outputPath: string;
  content: string;
}

/**
 * 纯内存模板渲染引擎 (Pure Transformation Engine)
 *
 * 接收字段定义与上下文，返回内存中的渲染产物，零磁盘 I/O 依赖，极易单测。
 */
export const TemplateRenderer = {
  /**
   * 构建 Handlebars 上下文对象
   */
  buildContext(name: string, fieldDefs: FieldDef[], scope: ModuleScope = 'admin'): TemplateContext {
    const featureName = toCamelCase(name);
    const FeatureName = toPascalCase(featureName);
    const tableName = pluralize(toSnakeCase(featureName));
    const resolvedScope: ModuleScope = scope === 'client' ? 'client' : 'admin';
    const featureModulePath =
      resolvedScope === 'admin' ? `features/admin/${featureName}` : `features/client/${featureName}`;
    const routePrefix = resolvedScope === 'admin' ? `admin/${tableName}` : tableName;

    const fields = TemplateRenderer.buildTemplateFields(fieldDefs);
    const filterFields = fields.filter((f) => f.name !== 'id');
    const searchFields = fields.filter((f) => SEARCHABLE_TYPES.has(f.type as FieldType));
    const uniqueFields = fields.filter((f) => f.type === 'email' || f.name === 'name');

    return {
      featureName,
      FeatureName,
      description: FeatureName,
      tableName,
      tableVariable: tableName,
      scope: resolvedScope,
      routePrefix,
      featureModulePath,
      pageSize: 15,
      hasVarchar: hasType(fieldDefs, VARCHAR_TYPES),
      hasText: hasType(fieldDefs, TEXT_TYPES),
      hasInteger: hasType(fieldDefs, INTEGER_TYPES),
      hasReal: hasType(fieldDefs, REAL_TYPES),
      hasBoolean: hasType(fieldDefs, BOOLEAN_TYPES),
      hasTimestamp: hasType(fieldDefs, TIMESTAMP_TYPES),
      hasEmail: fieldDefs.some((f) => f.type === 'email'),
      hasRelations: false,
      hasUniqueFields: uniqueFields.length > 0,
      fields,
      createFields: fields,
      updateFields: fields,
      filterFields,
      searchFields,
      uniqueFields,
    };
  },

  /**
   * 构建模板字段数组
   */
  buildTemplateFields(fieldDefs: FieldDef[]): TemplateField[] {
    return fieldDefs.map((f) => {
      const dbColumnName = toSnakeCase(f.name);
      const cfg = FIELD_TYPE_MAP[f.type];
      const description = f.description || f.name;
      const tsType = cfg.tsType;
      const isOptional = f.required === false;

      // 可选字段去掉 .notNull()
      const drizzleType = isOptional
        ? cfg.drizzle.replace('%s', dbColumnName).replace('.notNull()', '')
        : cfg.drizzle.replace('%s', dbColumnName);

      let zodValidation = CREATE_ZOD_VALIDATORS[f.type] ?? 'z.string()';
      if (description) {
        zodValidation += `.describe('${escapeTsString(description)}')`;
      }
      if (isOptional) {
        zodValidation += '.optional()';
      }

      let zodFilterValidation = FILTER_ZOD_VALIDATORS[f.type] ?? 'z.string().optional()';
      if (description) {
        zodFilterValidation += `.describe('搜索 ${escapeTsString(description)}')`;
      }
      return {
        name: f.name,
        type: f.type,
        description,
        dbColumnName,
        drizzleType,
        tsType,
        isOptional,
        apiProperty: buildApiProperty(f.name, description, tsType, isOptional),
        responseApiProperty: buildApiProperty(f.name, description, tsType, isOptional),
        zodValidation,
        zodFilterValidation,
        mockValue: cfg.mock,
        createMockValue: cfg.mock,
      };
    });
  },

  /**
   * 渲染所有模板产物为内存字符串数组
   */
  renderAll(tmplDir: string, ctx: TemplateContext): RenderedArtifact[] {
    const artifacts: RenderedArtifact[] = [];

    for (const entry of TEMPLATE_FILES) {
      const templatePath = join(tmplDir, entry.template);
      if (!existsSync(templatePath)) {
        continue;
      }
      const source = readFileSync(templatePath, 'utf8');
      const compiled = Handlebars.compile(source);
      const content = compiled(ctx);
      artifacts.push({
        outputPath: entry.output(ctx),
        content,
      });
    }

    return artifacts;
  },
};
