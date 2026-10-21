import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Injectable, Logger } from '@nestjs/common';

import { ArtifactWriter, type DeleteResult } from './artifact-writer';
import { SchemaInspector } from './schema-inspector';
import { TemplateRenderer } from './template-renderer';
import type { FieldDef, ModuleScope, TemplateContext } from './types';

const currentDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

/**
 * CRUD module generator facade (CrudGeneratorService)
 *
 * Focused on flow orchestration and lifecycle; the underlying responsibilities are
 * fully decoupled:
 * 1. `SchemaInspector`: Drizzle schema parsing and structure detection;
 * 2. `TemplateRenderer`: pure in-memory Handlebars rendering (zero I/O, fast tests);
 * 3. `ArtifactWriter`: safe writes, conflict detection, module registration and rollback.
 */
@Injectable()
export class CrudGeneratorService {
  private readonly logger = new Logger(CrudGeneratorService.name);

  /**
   * Generate a full CRUD module (supports admin and client scopes).
   */
  generate(
    name: string,
    fieldDefs: FieldDef[],
    force = false,
    scope: ModuleScope = 'admin',
  ): { ctx: TemplateContext; files: string[] } | null {
    const ctx = TemplateRenderer.buildContext(name, fieldDefs, scope);
    const projectRoot = process.cwd();
    const tmplDir = resolve(currentDir, 'templates');

    // 1. Conflict detection (skipped in --force mode)
    if (!force) {
      const conflicts = ArtifactWriter.detectConflicts(projectRoot, ctx);
      if (conflicts.length > 0) {
        for (const c of conflicts) this.logger.error(c);
        return null;
      }
    }

    // 2. Pure in-memory template rendering
    const artifacts = TemplateRenderer.renderAll(tmplDir, ctx);

    // 3. Safe disk writes
    const writtenFiles = ArtifactWriter.writeArtifacts(projectRoot, artifacts);

    // 4. Register the Drizzle schema export
    ArtifactWriter.updateSchemaExport(projectRoot, ctx.featureName, 'register');

    // 5. Register into the matching entry point (AdminModule or src/features/index.ts)
    ArtifactWriter.updateModuleRegistration(projectRoot, ctx.featureName, ctx.scope, 'register');

    return { ctx, files: writtenFiles };
  }

  /**
   * Detect conflicts
   */
  detectConflicts(projectRoot: string, ctx: TemplateContext): string[] {
    return ArtifactWriter.detectConflicts(projectRoot, ctx);
  }

  /**
   * Safely delete a generated CRUD module.
   */
  deleteModule(name: string, scope?: ModuleScope): DeleteResult {
    return ArtifactWriter.deleteModule(process.cwd(), name, scope);
  }

  /**
   * Parse field definitions from a Drizzle schema source file.
   */
  parseSchemaFields(schemaFileName: string, tableName: string): { errors: string[]; fieldDefs: FieldDef[] | null } {
    const schemaPath = join(process.cwd(), 'src', 'database', 'drizzle', 'schema', `${schemaFileName}.schema.ts`);
    const result = SchemaInspector.parseSchemaFields(schemaPath, tableName);

    if (result.fieldDefs && result.errors.length === 0) {
      this.logger.log(`Parsed ${result.fieldDefs.length} field(s) from ${schemaFileName}.schema.ts / ${tableName}`);
    }

    return result;
  }
}
