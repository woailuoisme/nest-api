import 'dotenv/config';
// 必须早于其余 import：CLI 也承载长驻进程（serve / worker），探针需先于业务模块注册
import './setup/otel/telemetry';
import type { LoggerService } from '@nestjs/common';
import { CommandFactory, type CommanderOptionsType } from 'nest-commander';

import { createPinoLogger, PinoLoggerService } from '@/setup/logger';

import { CliModule } from './cli.module';
import { isProcessCommand, ProcessCommandsModule } from './commands/process-commands.module';
import { setupTimezone } from './config/timezone';

/** 仅在 TTY 且未声明 NO_COLOR 时着色（管道/重定向输出保持纯文本） */
const paint = (code: string) => (text: string) =>
  process.stdout.isTTY && !('NO_COLOR' in process.env) ? `\x1b[${code}m${text}\x1b[0m` : text;

const boldCyan = paint('1;36');
const cyan = paint('36');
const green = paint('32');
const yellow = paint('33');
const dim = paint('2');

/**
 * 帮助配色 — nest-commander 内嵌 commander 11（无 style* 钩子），
 * 通过覆写 Help 的格式化方法着色：Usage 标题、命令名、选项名三色区分，描述降噪。
 */
const helpConfiguration: NonNullable<CommanderOptionsType['helpConfiguration']> = {
  commandUsage: (cmd) => `${boldCyan(cmd.name())} ${dim(cmd.usage())}`,
  subcommandTerm: (cmd) => {
    const aliases = cmd.aliases();
    const name = aliases.length > 0 ? `${cmd.name()}|${aliases.join('|')}` : cmd.name();
    return green([name, cmd.usage()].filter(Boolean).join(' '));
  },
  subcommandDescription: (cmd) => dim(cmd.description()),
  optionTerm: (option) => yellow(option.flags),
  optionDescription: (option) => dim(option.description),
  argumentTerm: (arg) => cyan(arg.name()),
  argumentDescription: (arg) => dim(arg.description),
};

/** 命令层 Logger context 白名单：仅这些输出对 CLI 用户有意义 */
const CLI_LOG_CONTEXTS = new Set([
  'SearchImportCommand',
  'SearchFlushCommand',
  'SearchSyncSettingsCommand',
  'DbSeedCommand',
  'AppInitCommand',
  'CrudGenerateCommand',
  'CrudGeneratorService',
  'ArtifactWriter',
]);

/**
 * CLI 日志门面 — 只看命令层输出。
 *
 * CliModule 会初始化整个应用图，Drizzle/Storage/Wepay/MQTT 等服务的启动日志
 * 对命令行毫无价值，故按 context 白名单丢弃；error 始终放行便于排障。
 */
class CliLogger implements LoggerService {
  constructor(private readonly inner: PinoLoggerService) {}

  log(message: unknown, context?: string): void {
    if (this.allow(context)) this.inner.log(message, context);
  }

  warn(message: unknown, context?: string): void {
    if (this.allow(context)) this.inner.warn(message, context);
  }

  debug(message: unknown, context?: string): void {
    if (this.allow(context)) this.inner.debug?.(message, context);
  }

  verbose(message: unknown, context?: string): void {
    if (this.allow(context)) this.inner.verbose?.(message, context);
  }

  /** 错误一律放行 */
  error(message: unknown, trace?: string, context?: string): void {
    this.inner.error(message, trace, context);
  }

  private allow(context?: string): boolean {
    return context === undefined || CLI_LOG_CONTEXTS.has(context);
  }
}

async function bootstrap() {
  setupTimezone();

  // 长驻进程命令以最小模块为根：CliModule 的依赖图会与引导体创建的应用图各留一份 DB / Redis / BullMQ，
  // 而一次性命令（route:list / db:seed 等）仍需 CliModule 提供完整业务图
  const [verb] = process.argv.slice(2);
  const rootModule = isProcessCommand(verb) ? ProcessCommandsModule : CliModule;

  await CommandFactory.run(rootModule, {
    logger: new CliLogger(new PinoLoggerService(await createPinoLogger())),
    helpConfiguration,
  });
}

bootstrap();
