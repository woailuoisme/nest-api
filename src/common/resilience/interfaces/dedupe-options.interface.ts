import type { BaseCommand } from '../commands/base.command.js';

export interface DedupeOptions {
  keyFn?: (args: unknown[], command: BaseCommand) => string;
}
