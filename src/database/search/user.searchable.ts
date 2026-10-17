import { asc, gt, inArray } from 'drizzle-orm';

import type { SearchableDefinition } from '@/common/search/scout/searchable.interface';
import type { DrizzleDB } from '@/database/drizzle/drizzle.service';
import { user } from '@/database/drizzle/schema';

export type UserEntity = typeof user.$inferSelect;

export type UserSearchDocument = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  phoneNumber: string | null;
  role: string | null;
  banned: boolean;
  createdAt: number;
};

/** 实体 → 索引文档映射（toSearchableArray 与其别名 toSearchable 共用同一实现） */
const toUserSearchDocument = (entity: UserEntity): UserSearchDocument => ({
  id: entity.id,
  name: entity.name,
  email: entity.email,
  username: entity.username ?? null,
  phoneNumber: entity.phoneNumber ?? null,
  role: entity.role ?? 'user',
  banned: Boolean(entity.banned),
  createdAt: entity.createdAt ? Math.floor(new Date(entity.createdAt).getTime() / 1000) : 0,
});

export const userSearchable: SearchableDefinition<UserEntity, UserSearchDocument> = {
  index: 'users',
  indexName: 'users',
  primaryKey: 'id',
  settings: {
    searchableAttributes: ['name', 'email', 'username', 'phoneNumber'],
    filterableAttributes: ['role', 'banned', 'createdAt'],
    sortableAttributes: ['createdAt', 'name'],
  },
  toSearchableArray: toUserSearchDocument,
  toSearchable: toUserSearchDocument,
  loadRecords: async (db: DrizzleDB, ids: (string | number)[]): Promise<UserEntity[]> => {
    if (ids.length === 0) {
      return [];
    }
    const stringIds = ids.map(String);
    return db.select().from(user).where(inArray(user.id, stringIds));
  },
  cursorLoader: async (db: DrizzleDB, { batchSize, afterId }) => {
    const query = afterId
      ? db
          .select()
          .from(user)
          .where(gt(user.id, String(afterId)))
          .orderBy(asc(user.id))
          .limit(batchSize)
      : db.select().from(user).orderBy(asc(user.id)).limit(batchSize);

    const records = await query;
    const nextCursor = records.length === batchSize ? records[records.length - 1]?.id : undefined;

    return {
      records,
      nextCursor,
    };
  },
};
