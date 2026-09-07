declare module 'pino-roll' {
  import type { Writable } from 'node:stream';

  export interface PinoRollOptions {
    file: string;
    frequency?: string | number;
    size?: string | number;
    mkdir?: boolean;
    dateFormat?: string;
    extension?: string;
    limit?: { count?: number; removeOtherLogFiles?: boolean; [key: string]: unknown };
    [key: string]: unknown;
  }

  export default function pinoRoll(options: PinoRollOptions): Promise<Writable>;
}
