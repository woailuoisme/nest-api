import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { createPgPool } from '@/database/drizzle/pg';

describe('createPgPool', () => {
  it('注册 error 监听：空闲连接异常只记录日志，不冒泡打崩进程', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const pool = createPgPool('postgresql://unused:unused@127.0.0.1:1/unused', { max: 1 });

    expect(pool.listenerCount('error')).toBe(1);
    expect(() => pool.emit('error', new Error('idle client terminated'))).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith('Idle PostgreSQL client error: idle client terminated', expect.any(String));

    await pool.end();
  });
});
