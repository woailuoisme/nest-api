import { Global, Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchSyncService } from './search-sync.service';

/**
 * 全局搜索引擎模块
 *
 * 导出 SearchService (流式查询构建器与驱动核心) 和 SearchSyncService (增量同步门面)。
 * 业务模块无需重复导入即可注入 SearchService / SearchSyncService。
 */
@Global()
@Module({
  providers: [SearchService, SearchSyncService],
  exports: [SearchService, SearchSyncService],
})
export class SearchModule {}
