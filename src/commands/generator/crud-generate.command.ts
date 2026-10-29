import { Injectable, Logger } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';

import { CrudGeneratorService } from './crud-generator.service';
import type { CommandOptions } from './types';

/**
 * crud:generate CLI command — generate / overwrite / delete a full CRUD module
 * (always lands inside the /admin boundary unless scope=client).
 *
 * Artifacts go to src/features/<scope>/<feature>/ and are auto-registered into
 * AdminModule (protected by @Can(AdminPolicy)) or the client feature list.
 *
 * Usage:
 *   just cmd crud:generate -n product --from-schema auth --from-entity users
 *   just cmd crud:generate -n product --from-schema auth --from-entity users --force
 *   just cmd crud:generate -n product --delete
 */
@Command({
  name: 'crud:generate',
  description:
    'Generate a full CRUD module (DTO / Service / Controller / Module / Schema / unit tests) from a Drizzle schema table.\n' +
    '  --from-schema  schema file name (no path or extension), e.g. auth\n' +
    '  --from-entity  exported pgTable variable name, e.g. users\n' +
    '  --delete       safely remove a generated module (only files marked with @generated)\n' +
    '  --force        overwrite existing files',
})
@Injectable()
export class CrudGenerateCommand extends CommandRunner {
  private readonly logger = new Logger(CrudGenerateCommand.name);

  constructor(private readonly generator: CrudGeneratorService) {
    super();
  }

  async run(_passedParams: string[], options?: CommandOptions): Promise<void> {
    const name = options?.name;

    if (!name) {
      this.logger.error('Missing required option: --name');
      return;
    }

    // ── --delete mode: safe rollback ─────────────────
    if (options?.delete) {
      this.runDelete(name, options?.scope);
      return;
    }

    // ── generate mode ────────────────────────────────
    const fromSchema = options?.fromSchema;
    const fromEntity = options?.fromEntity;
    const scope = options?.scope ?? 'admin';

    if (!fromSchema || !fromEntity) {
      this.logger.error('Missing required options: --from-schema and --from-entity (not needed with --delete)');
      return;
    }

    const force = options?.force ?? false;

    const { errors, fieldDefs } = this.generator.parseSchemaFields(fromSchema, fromEntity);
    if (errors.length > 0 || !fieldDefs) {
      for (const err of errors) this.logger.error(err);
      return;
    }

    const result = this.generator.generate(name, fieldDefs, force, scope);
    if (!result) {
      this.logger.error('Generation aborted — file conflicts detected, use --force to overwrite');
      return;
    }

    this.printSummary(result.ctx.FeatureName, result.ctx.scope, result.ctx.routePrefix);
  }

  // ── Options ──────────────────────────────────────

  @Option({
    flags: '-n, --name <name>',
    description: 'Module name (e.g. product), auto-converted to a plural table name',
    required: true,
  })
  parseName(val: string): string {
    return val;
  }

  @Option({
    flags: '-s, --scope <scope>',
    description: 'Module scope: admin (default, back-office) | client (client-facing)',
    defaultValue: 'admin',
  })
  parseScope(val: string): 'admin' | 'client' {
    return val.toLowerCase() === 'client' ? 'client' : 'admin';
  }

  @Option({
    flags: '--from-schema <schemaFile>',
    description: 'Drizzle schema file name (no path or extension), e.g. auth',
  })
  parseFromSchema(val: string): string {
    return val;
  }

  @Option({
    flags: '--from-entity <entityName>',
    description: 'Exported pgTable variable name, e.g. users',
  })
  parseFromEntity(val: string): string {
    return val;
  }

  @Option({ flags: '--force', description: 'Overwrite existing files', defaultValue: false })
  parseForce(): boolean {
    return true;
  }

  @Option({
    flags: '--delete',
    description: 'Safely remove a generated module (only files marked with @generated)',
    defaultValue: false,
  })
  parseDelete(): boolean {
    return true;
  }

  // ── private ──────────────────────────────────────

  /** Run the safe delete rollback */
  private runDelete(name: string, scope?: 'admin' | 'client'): void {
    this.logger.log(`Preparing to delete module: ${name} (scope=${scope ?? 'all'})`);
    const { deleted, skipped, errors } = this.generator.deleteModule(name, scope);

    if (deleted.length > 0) {
      this.logger.log('Deleted:');
      for (const f of deleted) this.logger.log(`  + ${f}`);
    }
    if (skipped.length > 0) {
      this.logger.warn('Skipped (not generated files):');
      for (const f of skipped) this.logger.warn(`  - ${f}`);
    }
    if (errors.length > 0) {
      for (const e of errors) this.logger.error(e);
    }

    if (deleted.length === 0 && skipped.length === 0 && errors.length === 0) {
      this.logger.log('No deletable files found');
    }
  }

  private printSummary(FeatureName: string, scope: 'admin' | 'client', routePrefix: string): void {
    this.logger.log('----------------------------------------');
    this.logger.log(`crud:generate — ${FeatureName} module generated. [scope=${scope}]`);
    if (scope === 'admin') {
      this.logger.log(
        `1. Module auto-registered into AdminModule (/${routePrefix} routes protected by @Can(AdminPolicy), ADMIN only)`,
      );
    } else {
      this.logger.log(
        `1. Module auto-registered into src/features/index.ts (/${routePrefix} mounted on the client feature list)`,
      );
    }
    this.logger.log('2. Run just db-gen && just db-migrate to apply the new table migration');
    this.logger.log(
      `3. Add abilities to a @Policy() class and annotate the controller routes with @Can() / @Can.Anyone() (authorization is deny-by-default)`,
    );
    this.logger.log('----------------------------------------');
  }
}
