/**
 * 队列名全局常量 — 集中统一定义所有 BullMQ 队列名，
 * 生产者（QueuesModule）/ 消费者（WorkerModule）/ 调度（SchedulesModule）共用，
 * 避免队列名散落各文件导致不一致。
 */

/** 默认队列名（BullMQ 默认队列，registerQueue 未显式命名时使用） */
export const DEFAULT_QUEUE = 'default';

/** 演示队列名 */
export const DEMO_QUEUE = 'demo';

/** 邮件队列名 */
export const MAIL_QUEUE = 'mail';

/** Token 清理队列名 */
export const TOKEN_CLEANUP_QUEUE = 'token-cleanup';

/** 媒体处理队列名 (图像转码与多规格缩略图衍生) */
export const MEDIA_QUEUE = 'media';

/** 全文搜索索引同步队列名 (Meilisearch 异步增删改索引) */
export const SEARCH_QUEUE = 'search';

/**
 * 全部队列清单 — 生产者（JobsModule）与消费者（WorkerModule）统一据此注册，
 * 确保两侧队列集合恒定一致（新增队列只需在此追加一次）。
 */
export const ALL_QUEUE_NAMES = [MAIL_QUEUE, TOKEN_CLEANUP_QUEUE, DEMO_QUEUE, MEDIA_QUEUE, SEARCH_QUEUE] as const;
