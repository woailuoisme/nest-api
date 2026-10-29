import { describe, expect, it } from 'vitest';

import { matchLegacyJournalNames } from '@/commands/utils/migrations.util';

describe('matchLegacyJournalNames', () => {
  it('按秒精度把 pre-v1 记录匹配到迁移目录名', () => {
    const rows = [
      { id: 1, created_at: '1792515704285' },
      { id: 2, created_at: 1_793_199_570_000 },
    ];
    const migrations = [
      { folderMillis: 1_792_515_704_000, name: '20261020170144_boring_doorman' },
      { folderMillis: 1_793_199_570_000, name: '20261028145930_cultured_zemo' },
    ];

    expect(matchLegacyJournalNames(rows, migrations)).toEqual([
      { id: 1, name: '20261020170144_boring_doorman' },
      { id: 2, name: '20261028145930_cultured_zemo' },
    ]);
  });

  it('时间戳无法对应时保留原行，交由调用方 fail-closed', () => {
    const rows = [{ id: 7, created_at: 1_700_000_000_000 }];
    const migrations = [{ folderMillis: 1_792_515_704_000, name: '20261020170144_boring_doorman' }];

    expect(matchLegacyJournalNames(rows, migrations)).toEqual([]);
  });
});
