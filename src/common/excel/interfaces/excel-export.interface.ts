import type * as ExcelJS from 'exceljs';

/**
 * 导出数据集合的数据源接口
 * 支持同步数组和 AsyncIterable 两种数据源，
 * AsyncIterable 可用于数据库游标/流式读取，避免全量加载到内存
 */
export interface FromCollection<T = unknown> {
  /**
   * 获取待导出的数据列表
   * - 返回 T[]：内存数据（适合小数据量）
   * - 返回 AsyncIterable<T>：流式迭代（适合百万级数据，逐条产出不占内存）
   */
  collection(): Promise<T[]> | T[] | AsyncIterable<T>;
}

/** Excel 表头列名 */
export interface WithHeadings {
  headings(): string[];
}

/** 单行映射转换 */
export interface WithMapping<T = unknown> {
  map(row: T): (string | number | boolean | Date | null | undefined)[];
}

/** 列宽配置 */
export interface WithColumnWidths {
  columnWidths(): number[] | Record<string, number>;
}

/** 工作表 Sheet 名称 */
export interface WithTitle {
  title(): string;
}

/** 自定义工作表样式（流式模式下传入的是 stream.xlsx.WorksheetWriter，不支持完整 Cells API） */
export interface WithStyles {
  styles(worksheet: ExcelJS.Worksheet): void;
}

/** Excel 导出组合类型 */
export type ExcelExportable<T = unknown> = FromCollection<T> &
  Partial<WithHeadings> &
  Partial<WithMapping<T>> &
  Partial<WithColumnWidths> &
  Partial<WithTitle> &
  Partial<WithStyles>;
