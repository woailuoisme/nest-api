import { z } from 'zod';

/**
 * Spatie Query Builder（v7）通用查询参数 schema。
 *
 * 供列表端点与 `crud:generate` 产出的 DTO 复用，确保 `filter` / `sort` / `include` / `fields`
 * 在 `@Query({ schema })` 中显式声明 —— 否则 Zod `strip` 会静默丢弃，表现为「200 但过滤未生效」。
 *
 * 括号键（`filter[name]=x` / `fields[users]=id`）由适配器展开为一层嵌套对象后再进入校验，
 * 见 `src/setup/query-expander.ts`。
 */
export const SpatieQueryParamsSchema = z.object({
  sort: z.string().optional().describe('排序表达式 (如 -createdAt,name)'),
  filter: z.record(z.string(), z.string()).optional().describe('过滤条件 (如 filter[salary]=>=3000)'),
  include: z.string().optional().describe('关联预加载 (如 posts,comments)'),
  fields: z.record(z.string(), z.string()).optional().describe('稀疏字段集 (如 fields[users]=id,name)'),
});

export type SpatieQueryParams = z.infer<typeof SpatieQueryParamsSchema>;
