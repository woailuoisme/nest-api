/**
 * 导入数据接收接口 — 逐行回调模型
 *
 * 与旧版 ToCollection(全量数组) 的区别：
 * - 旧版：`collection(rows: T[])` → 所有数据一次性加载到内存
 * - 新版：`each(row: T)` → 流式逐行回调，内存只保留当前行
 *
 * 百万级 Excel 导入场景下内存占用从 X MB 降至几十 KB。
 */
export interface ToRows<T = unknown> {
  /**
   * 逐行处理导入数据
   * @param row 单行数据对象
   * @param index 行索引（0-based，不含表头）
   *
   * 可在 each 中直接写入数据库、跳过无效行、或收集到 sparse 批次数组。
   * 若返回 Promise，导入函数会 await。
   */
  each(row: T, index: number): Promise<void> | void;
}

/** 表头所在行号（1-indexed，默认 1） */
export interface WithHeadingRow {
  headingRow(): number;
}

/** Excel 导入组合类型 */
export type ExcelImportable<T = unknown> = ToRows<T> & Partial<WithHeadingRow>;
