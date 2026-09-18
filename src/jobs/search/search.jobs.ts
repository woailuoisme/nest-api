import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job, JobsOptions, Queue } from 'bullmq';
import { SEARCH_QUEUE } from '@/common/constants/queues';

/** 搜索任务统一重试与保留策略：指数退避 3 次；成功保留 100 条、失败保留 500 条便于排障 */
const SEARCH_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: 100,
  removeOnFail: 500,
};

/** 搜索队列任务名称枚举 */
export enum SearchJobName {
  Index = 'search-index',
  Delete = 'search-delete',
}

/** 索引文档任务数据 */
export interface SearchIndexJobData {
  indexName: string;
  documents: Record<string, unknown>[];
  primaryKey?: string;
}

/** 删除文档任务数据 */
export interface SearchDeleteJobData {
  indexName: string;
  ids: (string | number)[];
}

/**
 * 搜索队列生产者 — 向 BullMQ 投递搜索文档的索引与删除任务。
 */
@Injectable()
export class SearchJobs {
  constructor(@InjectQueue(SEARCH_QUEUE) private readonly queue: Queue) {}

  /**
   * 投递批量增量索引任务
   */
  async dispatchIndex(
    indexName: string,
    documents: Record<string, unknown>[],
    primaryKey?: string,
  ): Promise<Job<SearchIndexJobData>> {
    return this.queue.add(SearchJobName.Index, { indexName, documents, primaryKey }, SEARCH_JOB_OPTIONS);
  }

  /**
   * 投递文档批量删除任务
   */
  async dispatchDelete(indexName: string, ids: (string | number)[]): Promise<Job<SearchDeleteJobData>> {
    return this.queue.add(SearchJobName.Delete, { indexName, ids }, SEARCH_JOB_OPTIONS);
  }
}
