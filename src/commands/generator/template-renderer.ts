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
  RESPONSE_ZOD_VALIDATORS,
  SEARCHABLE_TYPES,
  TEXT_TYPES,
  TIMESTAMP_TYPES,
  VARCHAR_TYPES,
} from './field-mappings';
import { buildApiProperty } from './swagger.snippet';
import type { FieldDef, FieldType, ModuleScope, TemplateContext, TemplateField } from './types';
import { escapeTsString, pluralize, toCamelCase, toPascalCase, toSnakeCase } from './utils/string.util';

// ─── Idempotent Handlebars helper registration ──────────────────

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
 * Pure in-memory template rendering engine (Pure Transformation Engine)
 *
 * Takes field definitions and a context, returns in-memory rendered artifacts with zero disk I/O — trivially unit-testable.
 */
export const TemplateRenderer = {
  /**
   * Build the Handlebars context object
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
   * Build the template field array
   */
  buildTemplateFields(fieldDefs: FieldDef[]): TemplateField[] {
    return fieldDefs.map((f) => {
      const dbColumnName = toSnakeCase(f.name);
      const cfg = FIELD_TYPE_MAP[f.type];
      const description = f.description || f.name;
      const tsType = cfg.tsType;
      const isOptional = f.required === false;

      // optional fields drop .notNull()
      const drizzleType = isOptional
        ? cfg.drizzle.replace('%s', dbColumnName).replace('.notNull()', '')
        : cfg.drizzle.replace('%s', dbColumnName);

      // 三种 zod 变体的 `.describe()` 文案统一拼装：转义与引号规则只维护一处
      const describe = (schema: string, text: string) => `${schema}.describe('${escapeTsString(text)}')`;

      let zodValidation = CREATE_ZOD_VALIDATORS[f.type] ?? 'z.string()';
      if (description) zodValidation = describe(zodValidation, description);
      if (isOptional) zodValidation += '.optional()';

      let zodFilterValidation = FILTER_ZOD_VALIDATORS[f.type] ?? 'z.string().optional()';
      if (description) zodFilterValidation = describe(zodFilterValidation, `Search ${description}`);

      // response resource schema: output type (no input constraints); optional columns are null on the entity
      let zodResponseValidation = RESPONSE_ZOD_VALIDATORS[f.type] ?? 'z.string()';
      if (isOptional) zodResponseValidation += '.nullable()';
      if (description) zodResponseValidation = describe(zodResponseValidation, description);

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
        zodResponseValidation,
        mockValue: cfg.mock,
        createMockValue: cfg.mock,
      };
    });
  },

  /**
   * Render all template artifacts into in-memory strings
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
