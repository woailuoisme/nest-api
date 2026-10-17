import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';

interface JwtSecretCommandOptions {
  show?: boolean;
  env?: string;
}

@Command({
  name: 'jwt:secret',
  aliases: ['auth:secret'],
  description: 'Generate and update BETTER_AUTH_SECRET and JWT secrets in .env',
})
@Injectable()
export class JwtSecretCommand extends CommandRunner {
  async run(_passedParams: string[], options?: JwtSecretCommandOptions): Promise<void> {
    const show = options?.show ?? false;
    const envFile = options?.env ?? '.env';

    const betterAuthSecret = randomBytes(32).toString('base64url');
    const accessSecret = randomBytes(64).toString('base64url');
    const refreshSecret = randomBytes(64).toString('base64url');

    const targetPath = resolve(envFile);

    let content = '';
    if (existsSync(targetPath)) {
      content = readFileSync(targetPath, 'utf8');
    }

    content = this.updateOrAppendEnv(content, 'BETTER_AUTH_SECRET', betterAuthSecret);
    content = this.updateOrAppendEnv(content, 'JWT_ACCESS_SECRET', accessSecret);
    content = this.updateOrAppendEnv(content, 'JWT_REFRESH_SECRET', refreshSecret);

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');

    console.log(`\x1b[32m[auth:secret]\x1b[0m Successfully updated auth secrets in ${targetPath}`);

    if (show) {
      console.log(`\n\x1b[36mBETTER_AUTH_SECRET:\x1b[0m\n${betterAuthSecret}`);
      console.log(`\x1b[36mJWT_ACCESS_SECRET:\x1b[0m\n${accessSecret}`);
      console.log(`\x1b[36mJWT_REFRESH_SECRET:\x1b[0m\n${refreshSecret}\n`);
    }
  }

  @Option({
    flags: '-s, --show',
    description: 'Display generated secrets in console',
  })
  parseShow(): boolean {
    return true;
  }

  @Option({
    flags: '-e, --env <path>',
    description: 'Path to target .env file',
    defaultValue: '.env',
  })
  parseEnv(val: string): string {
    return val;
  }

  private updateOrAppendEnv(content: string, key: string, value: string): string {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const newLine = `${key}=${value}`;

    if (regex.test(content)) {
      return content.replace(regex, newLine);
    }

    const prefix = content && !content.endsWith('\n') ? '\n' : '';
    return `${content}${prefix}${newLine}\n`;
  }
}
