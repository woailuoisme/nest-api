/**
 * 搜索引擎索引高级配置
 */
export interface IndexSettings {
  /** 参与全文分词检索的属性列表（按相关性从高到低排序） */
  searchableAttributes?: string[];
  /** 可用于 filter 条件过滤的属性列表 */
  filterableAttributes?: string[];
  /** 可用于 sort 排序的属性列表 */
  sortableAttributes?: string[];
  /** 排序计算规则顺序 */
  rankingRules?: string[];
  /** 停用词列表 */
  stopWords?: string[];
  /** 同义词映射表 */
  synonyms?: Record<string, string[]>;
  /** 去重主键属性 */
  distinctAttribute?: string;
}

/**
 * 搜索检索参数选项
 */
export interface SearchParams {
  /** 过滤表达式（支持 Meilisearch 语法如 "role = admin AND banned = false" 或数组） */
  filter?: string | string[] | (string | string[])[];
  /** 排序规则列表（例如 ['createdAt:desc', 'name:asc']） */
  sort?: string[];
  /** 返回文档数量 */
  limit?: number;
  /** 分页偏移量 */
  offset?: number;
  /** 需要高亮展示的属性列表（默认 ['*']） */
  attributesToHighlight?: string[];
  /** 需要截断裁剪的属性列表 */
  attributesToCrop?: string[];
  /** 裁剪文本字符长度 */
  cropLength?: number;
  /** 高亮前置标签，默认 <em> */
  highlightPreTag?: string;
  /** 高亮后置标签，默认 </em> */
  highlightPostTag?: string;
  /** 是否返回分词匹配位置信息 */
  showMatchesPosition?: boolean;
}

/**
 * 统一搜索结果信封结构
 */
export interface SearchResult<T = Record<string, unknown>> {
  /** 命中结果集（包含 _formatted 高亮等引擎元数据） */
  hits: T[];
  /** 原始查询词 */
  query: string;
  /** 页面限制量 */
  limit: number;
  /** 分页偏移量 */
  offset: number;
  /** 预估总命中数 */
  estimatedTotalHits?: number;
  /** 精确总命中数 */
  totalHits?: number;
  /** 引擎耗时（毫秒） */
  processingTimeMs: number;
  /** 分面聚合统计 */
  facetDistribution?: Record<string, Record<string, number>>;
}

/**
 * 搜索引擎健康状态结构
 */
export interface SearchDriverHealth {
  status: 'up' | 'down';
  driver: string;
  message?: string;
  version?: string;
}

/**
 * 统一搜索驱动契约接口
 */
export interface SearchDriver {
  readonly name: string;
  createOrUpdateIndex(indexName: string, primaryKey?: string): Promise<void>;
  deleteIndex(indexName: string): Promise<void>;
  updateSettings(indexName: string, settings: IndexSettings): Promise<void>;
  addDocuments(indexName: string, documents: Record<string, unknown>[], primaryKey?: string): Promise<void>;
  deleteDocuments(indexName: string, documentIds: (string | number)[]): Promise<void>;
  deleteDocument(indexName: string, documentId: string | number): Promise<void>;
  deleteAllDocuments(indexName: string): Promise<void>;
  search<T extends Record<string, unknown> = Record<string, unknown>>(
    indexName: string,
    query: string,
    params?: SearchParams,
  ): Promise<SearchResult<T>>;
  checkHealth(): Promise<SearchDriverHealth>;
}
