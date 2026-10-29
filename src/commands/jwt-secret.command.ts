import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';

import { upsertEnvValue } from './utils/env-file.util';

interface JwtSecretCommandOptions {
  show?: boolean;
  env?: string;
}

@Command({
  name: 'jwt:secret',
  aliases: ['auth:secret'],
  description: 'Generate and update JWT_SECRET and MFA_ENCRYPTION_KEYS in .env',
})
@Injectable()
export class JwtSecretCommand extends CommandRunner {
  async run(_passedParams: string[], options?: JwtSecretCommandOptions): Promise<void> {
    const show = options?.show ?? false;
    const envFile = options?.env ?? '.env';

    const jwtSecret = randomBytes(32).toString('base64url');
    const mfaKey = randomBytes(32).toString('base64url');

    const targetPath = resolve(envFile);

    let content = '';
    if (existsSync(targetPath)) {
      content = readFileSync(targetPath, 'utf8');
    }

    content = upsertEnvValue(content, 'JWT_SECRET', jwtSecret);
    content = upsertEnvValue(content, 'MFA_ENCRYPTION_KEYS', mfaKey);

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');

    console.log(`\x1b[32m[auth:secret]\x1b[0m Successfully updated auth secrets in ${targetPath}`);

    if (show) {
      console.log(`\n\x1b[36mJWT_SECRET:\x1b[0m\n${jwtSecret}`);
      console.log(`\x1b[36mMFA_ENCRYPTION_KEYS:\x1b[0m\n${mfaKey}\n`);
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
}
