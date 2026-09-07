/**
 * 队列名全局常量 — 集中统一定义所有 BullMQ 队列名，
 * 生产者（QueuesModule）/ 消费者（WorkerModule）/ 调度（SchedulesModule）/ 面板（BullBoard）共用，
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
