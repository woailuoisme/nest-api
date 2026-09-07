/** Token 清理队列任务名 */
export enum TokenCleanupJobName {
  PurgeExpired = 'purge-expired',
}

/** Token 清理任务数据载荷 */
export interface TokenCleanupJobData {
  /** 单批清理条数上限，防止长事务锁表 */
  batchSize: number;
}
