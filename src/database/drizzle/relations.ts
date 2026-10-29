import { defineRelations } from 'drizzle-orm';

import * as schema from './schema';

/**
 * Drizzle v1 关系声明：一次性覆盖整份 schema（含无关联的表），
 * 使 `db.query.<table>` 对每张表都可用，同时保留用户与凭据账户的嵌套查询能力。
 */
export const relations = defineRelations(schema, (r) => ({
  user: {
    accounts: r.many.account(),
  },
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
      optional: true,
    }),
  },
}));
