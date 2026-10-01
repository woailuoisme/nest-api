import 'dotenv/config';
import './setup/sentry';
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli.module';
import { setupTimezone } from './config/timezone';

async function bootstrap() {
  setupTimezone();
  await CommandFactory.run(CliModule, {
    /** 日志级别，可选值: false (静默) | ['log','error','warn','debug','verbose'] 任意子集 */
    logger: ['error', 'warn', 'log'],
  });
}

bootstrap();
