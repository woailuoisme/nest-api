import { createWriteStream } from 'node:fs';
import { PassThrough, Readable, Writable } from 'node:stream';
import { buffer as collectStreamBuffer } from 'node:stream/consumers';
import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { FastifyReply } from 'fastify';
import type { ExcelExportable } from './interfaces/excel-export.interface';
import type { ExcelImportable } from './interfaces/excel-import.interface';

// ─── 类型补丁：ExcelJS stream API 类型定义缺失 ─────────────
// ExcelJS 的 stream.WorkbookReader / stream.WorksheetReader 在运行时是 EventEmitter，
// 但官方 @types 没有暴露 .on() 泛型，这里声明本地接口补齐。

interface StreamWorkbookReader extends ExcelJS.stream.xlsx.WorkbookReader {
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'worksheet', listener: (worksheet: StreamWorksheetReader) => void): this;
}

interface StreamWorksheetReader {
  on(event: 'row', listener: (row: StreamRowReader) => void | Promise<void>): this;
}

interface StreamRowReader {
  readonly number: number;
  readonly hasValues?: boolean;
  eachCell(opts: { includeEmpty: boolean }, cb: (cell: ExcelJS.Cell, colNumber: number) => void): void;
}

// ─── 常量 ────────────────────────────────────────────────

/** 每 BATCH_SIZE 行让出一次事件循环以控制背压 */
const BATCH_SIZE = 1000;

/**
 * Excel 导入导出核心服务 — 全流式实现
 *
 * ## 导出：stream.xlsx.WorkbookWriter
 * - 逐行写入，内存仅保留当前批次
 * - `download` 直接 pipe 到 HTTP 响应流（零中间 Buffer）
 * - `store` pipe 到文件写入流（非阻塞，异步 I/O）
 * - `toBuffer` 收集到内存 Buffer（仅小数据量场景用）
 *
 * ## 导入：stream.xlsx.WorkbookReader
 * - 逐行事件驱动解析，不缓存全量数据
 * - `each(row, index)` 回调直接消费每一行
 *
 * ## 百万数据场景
 * 内存占用 ≈ 单批数据（BATCH_SIZE 行 × 字段数），通常在 10-50MB 以内，不会随总行数线性增长。
 */
@Injectable()
export class ExcelService {
  /** 导出为内存 Buffer — 小数据量场景 */
  async toBuffer<T>(exportable: ExcelExportable<T>): Promise<Buffer> {
    const passThrough = new PassThrough();

    // 收集端与写入端并发执行，避免大文件时 PassThrough 缓冲回压阻塞写入
    const [buffer] = await Promise.all([
      collectStreamBuffer(passThrough),
      this.#writeToStream(exportable, passThrough),
    ]);

    return buffer;
  }

  /** 导出并触发浏览器下载 — 流式 pipe，零中间 Buffer */
  async download<T>(exportable: ExcelExportable<T>, fileName: string, reply: FastifyReply): Promise<void> {
    const safeFileName = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;

    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFileName)}"`);
    reply.header('Transfer-Encoding', 'chunked');

    await this.#writeToStream(exportable, reply.raw);
  }

  /** 导出到磁盘 — 流式 pipe，异步非阻塞 I/O */
  async store<T>(exportable: ExcelExportable<T>, filePath: string): Promise<void> {
    const writeStream = createWriteStream(filePath);
    await this.#writeToStream(exportable, writeStream);
  }

  /**
   * 从文件路径或 Buffer 流式解析 Excel
   * @returns 解析的总行数
   */
  async import<T = Record<string, unknown>>(importable: ExcelImportable<T>, input: Buffer | string): Promise<number> {
    const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(
      typeof input === 'string' ? input : Readable.from(input),
      {},
    ) as StreamWorkbookReader;

    const headingRowNumber = importable.headingRow?.() ?? 1;
    let rowCount = 0;

    await new Promise<void>((resolve, reject) => {
      workbookReader.on('end', resolve);
      workbookReader.on('error', reject);

      workbookReader.on('worksheet', (worksheet: StreamWorksheetReader) => {
        const headers: string[] = [];

        worksheet.on('row', async (row: StreamRowReader) => {
          const { number: rowNumber, hasValues } = row;

          if (rowNumber === headingRowNumber) {
            row.eachCell({ includeEmpty: true }, (cell: ExcelJS.Cell, colNumber: number) => {
              const headerValue = this.#extractCellValue(cell.value);
              headers[colNumber - 1] = headerValue != null ? String(headerValue).trim() : `col_${colNumber}`;
            });
            return;
          }

          if (rowNumber < headingRowNumber || hasValues === false) {
            return;
          }

          const rowData: Record<string, unknown> = {};
          row.eachCell({ includeEmpty: true }, (cell: ExcelJS.Cell, colNumber: number) => {
            const key = headers[colNumber - 1] ?? `col_${colNumber}`;
            rowData[key] = this.#extractCellValue(cell.value);
          });

          await importable.each(rowData as T, rowCount);
          rowCount++;
        });
      });

      workbookReader.read().catch(reject);
    });

    return rowCount;
  }

  // ─── 私有方法 ──────────────────────────────────────────

  /** 流式写入 Excel 到目标 Writable */
  async #writeToStream<T>(exportable: ExcelExportable<T>, writable: Writable): Promise<void> {
    const workbookWriter = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: writable,
      useStyles: true,
    });

    const sheetName = exportable.title?.() ?? 'Sheet1';
    const worksheet = workbookWriter.addWorksheet(sheetName);

    // 表头
    const headings = exportable.headings?.();
    if (headings?.length) {
      const headerRow = worksheet.addRow(headings);
      headerRow.font = { bold: true };
      headerRow.commit();
    }

    // 列宽
    const widths = exportable.columnWidths?.();
    if (widths) {
      if (Array.isArray(widths)) {
        for (const [i, width] of widths.entries()) {
          worksheet.getColumn(i + 1).width = width;
        }
      } else {
        for (const [colKey, width] of Object.entries(widths)) {
          const col = worksheet.getColumn(colKey);
          if (col) col.width = width;
        }
      }
    }

    // 数据行
    const data = await exportable.collection();
    let count = 0;

    for await (const item of data as Iterable<T> | AsyncIterable<T>) {
      const cells = exportable.map?.(item) ?? this.#rowToCells(item);
      worksheet.addRow(cells).commit();

      if (++count % BATCH_SIZE === 0) {
        await yieldEventLoop();
      }
    }

    worksheet.commit();
    await workbookWriter.commit();
  }

  /** 无 map 时的默认行转换 */
  #rowToCells(row: unknown): unknown[] {
    if (typeof row === 'object' && row !== null) {
      return Object.values(row as Record<string, unknown>);
    }
    return [row];
  }

  /** 提取单元格有效值（兼容公式 & 富文本） */
  #extractCellValue(cellValue: unknown): unknown {
    if (cellValue && typeof cellValue === 'object') {
      const obj = cellValue as Record<string, unknown>;
      if ('result' in obj) return obj.result;
      if ('text' in obj) return obj.text;
      // 富文本对象 { richText: [...] } → 拼接所有 .text
      if (Array.isArray(obj.richText)) {
        return obj.richText.map((r: unknown) => (r as { text?: string })?.text ?? '').join('');
      }
    }
    return cellValue;
  }
}

/** 微任务让出事件循环 */
function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
