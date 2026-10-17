import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { SEARCH_QUEUE } from '@/common/constants/queues';
import { SearchService } from '@/common/search/search.service';

import { type SearchDeleteJobData, type SearchIndexJobData, SearchJobName } from './search.jobs';

/**
 * 搜索队列消费者 — 消费 BullMQ 任务并调用 SearchService 同步文档至搜索引擎（如 Meilisearch）。
 */
@Processor(SEARCH_QUEUE, { concurrency: 5 })
export class SearchProcessor extends WorkerHost {
  private readonly logger = new Logger(SearchProcessor.name);

  constructor(private readonly searchService: SearchService) {
    super();
  }

  async process(job: Job<SearchIndexJobData | SearchDeleteJobData>): Promise<void> {
    switch (job.name) {
      case SearchJobName.Index:
        await this.handleIndex(job.data as SearchIndexJobData);
        break;
      case SearchJobName.Delete:
        await this.handleDelete(job.data as SearchDeleteJobData);
        break;
      default:
        this.logger.warn(`Unknown search job name: ${job.name}`);
    }
  }

  /** 处理批量增量索引 */
  private async handleIndex(data: SearchIndexJobData): Promise<void> {
    if (!data.documents || data.documents.length === 0) {
      return;
    }
    await this.searchService.addDocuments(data.indexName, data.documents, data.primaryKey ?? 'id');
    this.logger.log(`成功为索引 ${data.indexName} 同步 ${data.documents.length} 条文档`);
  }

  /** 处理文档批量删除 */
  private async handleDelete(data: SearchDeleteJobData): Promise<void> {
    if (!data.ids || data.ids.length === 0) {
      return;
    }
    await this.searchService.deleteDocuments(data.indexName, data.ids);
    this.logger.log(`成功从索引 ${data.indexName} 删除 ${data.ids.length} 条文档`);
  }
}
