import { promises as fsPromises, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyReply } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS } from '@/common/constants/app.constants';
import { ExcelService } from '@/common/excel/excel.service';
import type { ExcelExportable } from '@/common/excel/interfaces/excel-export.interface';
import type { ExcelImportable } from '@/common/excel/interfaces/excel-import.interface';

interface TestRow {
  id: number;
  name: string;
  role: string;
}

describe('ExcelService', () => {
  let service: ExcelService;
  const testTmpDir = resolve(process.cwd(), PATHS.STORAGE_TMP, 'excel-tests');

  beforeEach(async () => {
    service = new ExcelService();
    await fsPromises.mkdir(testTmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fsPromises.rm(testTmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  describe('toBuffer', () => {
    it('should generate excel buffer from synchronous array', async () => {
      const exportable: ExcelExportable<TestRow> = {
        title: () => 'Users List',
        headings: () => ['ID', 'Name', 'Role'],
        collection: () => [
          { id: 1, name: 'Alice', role: 'Admin' },
          { id: 2, name: 'Bob', role: 'User' },
        ],
        map: (row) => [row.id, row.name, row.role],
        columnWidths: () => [10, 25, 15],
      };

      const buffer = await service.toBuffer(exportable);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should generate excel buffer from AsyncIterable', async () => {
      const iterable: AsyncIterable<TestRow> = {
        async *[Symbol.asyncIterator]() {
          yield { id: 1, name: 'Alice', role: 'Admin' };
          yield { id: 2, name: 'Bob', role: 'User' };
        },
      };

      const exportable: ExcelExportable<TestRow> = {
        headings: () => ['ID', 'Name', 'Role'],
        collection: () => iterable,
        map: (row) => [row.id, row.name, row.role],
      };

      const buffer = await service.toBuffer(exportable);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should support unmapped objects', async () => {
      const exportable: ExcelExportable<TestRow> = {
        collection: () => [{ id: 1, name: 'Alice', role: 'Admin' }],
      };

      const buffer = await service.toBuffer(exportable);
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it('should support columnWidths as Record (key-based)', async () => {
      const exportable: ExcelExportable<TestRow> = {
        headings: () => ['ID', 'Name'],
        collection: () => [{ id: 1, name: 'Alice', role: 'Admin' }],
        map: (row) => [row.id, row.name],
        columnWidths: () => ({ A: 10, B: 30 }),
      };

      const buffer = await service.toBuffer(exportable);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should export without headings (no header row)', async () => {
      const exportable: ExcelExportable<TestRow> = {
        collection: () => [{ id: 1, name: 'Alice', role: 'Admin' }],
        map: (row) => [row.id, row.name, row.role],
      };

      const buffer = await service.toBuffer(exportable);
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  describe('download', () => {
    it('should set response headers and pipe data via stream', async () => {
      const exportable: ExcelExportable<TestRow> = {
        collection: () => [{ id: 1, name: 'Alice', role: 'Admin' }],
      };

      const { PassThrough } = await import('node:stream');
      const passThrough = new PassThrough();
      const chunks: Buffer[] = [];
      passThrough.on('data', (chunk: Buffer) => chunks.push(chunk));

      const mockReply = {
        header: vi.fn().mockReturnThis(),
        raw: passThrough,
      } as unknown as FastifyReply;

      await service.download(exportable, 'users-export', mockReply as any);

      expect(mockReply.header).toHaveBeenCalledWith('Content-Type', expect.stringContaining('spreadsheetml'));
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should not duplicate .xlsx extension', async () => {
      const exportable: ExcelExportable<TestRow> = {
        collection: () => [{ id: 1, name: 'Alice', role: 'Admin' }],
      };

      const { PassThrough } = await import('node:stream');
      const passThrough = new PassThrough();
      passThrough.on('data', () => {});

      const mockReply = {
        header: vi.fn().mockReturnThis(),
        raw: passThrough,
      } as unknown as FastifyReply;

      await service.download(exportable, 'users-export.xlsx', mockReply as any);

      expect(mockReply.header).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('users-export.xlsx"'),
      );
    });
  });

  describe('store and import', () => {
    it('should store file to disk and import it back via each() callback', async () => {
      const exportable: ExcelExportable<TestRow> = {
        headings: () => ['id', 'name', 'role'],
        collection: () => [
          { id: 101, name: 'Charlie', role: 'Developer' },
          { id: 102, name: 'Dave', role: 'Tester' },
        ],
        map: (row) => [row.id, row.name, row.role],
      };

      const targetPath = resolve(testTmpDir, 'stored-users.xlsx');
      await service.store(exportable, targetPath);

      expect(readFileSync(targetPath)).toBeDefined();

      const importRows: Record<string, unknown>[] = [];
      const importable: ExcelImportable<Record<string, unknown>> = {
        each: (row) => {
          importRows.push(row);
        },
      };

      const rowCount = await service.import(importable, targetPath);

      expect(rowCount).toBe(2);
      expect(importRows).toHaveLength(2);
      expect(importRows[0]).toMatchObject({ id: 101, name: 'Charlie', role: 'Developer' });
      expect(importRows[1]).toMatchObject({ id: 102, name: 'Dave', role: 'Tester' });
    });

    it('should import excel from buffer with each() callback', async () => {
      const exportable: ExcelExportable<TestRow> = {
        headings: () => ['id', 'name', 'role'],
        collection: () => [{ id: 201, name: 'Eve', role: 'Manager' }],
        map: (row) => [row.id, row.name, row.role],
      };

      const filePath = resolve(testTmpDir, 'buffer-roundtrip.xlsx');
      await service.store(exportable, filePath);

      const rows: Record<string, unknown>[] = [];
      const importable: ExcelImportable<Record<string, unknown>> = {
        each: (row) => {
          rows.push(row);
        },
      };

      const rowCount = await service.import(importable, filePath);

      expect(rowCount).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: 201, name: 'Eve', role: 'Manager' });
    });

    it('should respect custom headingRow offset', async () => {
      const exportable: ExcelExportable<{ name: string; value: number }> = {
        headings: () => ['Name', 'Value'],
        collection: () => [
          { name: 'Alice', value: 100 },
          { name: 'Bob', value: 200 },
        ],
        map: (row) => [row.name, row.value],
      };

      const filePath = resolve(testTmpDir, 'heading-row.xlsx');
      await service.store(exportable, filePath);

      let callCount = 0;
      const importable: ExcelImportable<Record<string, unknown>> = {
        headingRow: () => 1,
        each: () => {
          callCount++;
        },
      };

      const rowCount = await service.import(importable, filePath);
      expect(rowCount).toBe(2);
      expect(callCount).toBe(2);
    });

    it('should handle empty workbook', async () => {
      const exportable: ExcelExportable<string> = {
        collection: () => [],
      };

      const buffer = await service.toBuffer(exportable);

      const rows: Record<string, unknown>[] = [];
      const importable: ExcelImportable<Record<string, unknown>> = {
        each: (row) => {
          rows.push(row);
        },
      };

      const rowCount = await service.import(importable, buffer);
      expect(rowCount).toBe(0);
    });

    it('should export and re-import via file path (store + import roundtrip)', async () => {
      const exportable: ExcelExportable<TestRow> = {
        headings: () => ['id', 'name', 'role'],
        collection: () => [
          { id: 101, name: 'Charlie', role: 'Developer' },
          { id: 102, name: 'Dave', role: 'Tester' },
        ],
        map: (row) => [row.id, row.name, row.role],
      };

      const targetPath = resolve(testTmpDir, 'roundtrip.xlsx');
      await service.store(exportable, targetPath);

      let callCount = 0;
      const importable: ExcelImportable<Record<string, unknown>> = {
        each: () => {
          callCount++;
        },
      };

      const rowCount = await service.import(importable, targetPath);
      expect(rowCount).toBe(callCount);
      expect(rowCount).toBe(2);
    });
  });
});
