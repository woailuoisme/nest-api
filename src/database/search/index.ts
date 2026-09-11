import type { SearchableDefinition } from '@/common/search/scout/searchable.interface';
import { userSearchable } from './user.searchable';

export * from './user.searchable';

/**
 * 全局实体搜索定义注册表
 * 用于 CLI 命令（search:import, search:flush, search:sync-settings）根据模型名动态查找对应契约
 */
export const SEARCHABLE_REGISTRY: Record<string, SearchableDefinition> = {
  user: userSearchable,
  users: userSearchable,
};
