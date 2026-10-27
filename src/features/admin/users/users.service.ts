import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hashPassword } from 'better-auth/crypto';
import { desc, eq } from 'drizzle-orm';
import { pick } from 'es-toolkit';
import { v7 as uuidv7 } from 'uuid';

import { Role } from '@/common/constants/roles';
import { PageMetaResource, PaginatedResultResource } from '@/common/dto/pagination.dto';
import { parseSpatieQuery } from '@/common/query/spatie-query';
import { SearchSyncService } from '@/common/search/search-sync.service';
import { SearchService } from '@/common/search/search.service';
import { paginateSpatieQuery } from '@/database/drizzle/drizzle-pagination';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { account, user } from '@/database/drizzle/schema';
import { userSearchable } from '@/database/search/user.searchable';

import { CreateUserRequest, FindUsersRequest, SearchUsersRequest, UpdateUserRequest, UserEntity } from './users.dto';

/** 角色权重：用于阻止越级授权（低权限持有者不得授予/剥夺同级及以上角色） */
const ROLE_RANK: Record<Role, number> = {
  [Role.USER]: 0,
  [Role.OPERATOR]: 1,
  [Role.ADMIN]: 2,
  [Role.SUPER_ADMIN]: 3,
};

/**
 * 解析角色权重（fail-closed）。
 *
 * `user.role` 是自由文本列（可空、无 CHECK 约束），可能包含历史值、小写值或
 * 仅存在于 better-auth 的角色。直接下标取值会得到 `undefined`，而 `undefined >= n` 为 false，
 * 会让「不得变更同级/更高角色」的检查静默失效——因此未知角色一律视为无权重并拒绝。
 */
function rankOf(role: string | null): number {
  const rank = role === null ? undefined : ROLE_RANK[role as Role];
  if (rank === undefined) {
    throw new ForbiddenException(`Unsupported role: ${String(role)}`);
  }
  return rank;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectDb() private readonly db: DrizzleDB,
    private readonly searchService: SearchService,
    private readonly searchSyncService: SearchSyncService,
  ) {}

  async create(dto: CreateUserRequest) {
    const existing = await this.db.query.user.findFirst({
      where: eq(user.email, dto.email),
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const userId = uuidv7();
    const passwordHash = await hashPassword(dto.password);

    const newUser = await this.db.transaction(async (tx) => {
      const [insertedUser] = await tx
        .insert(user)
        .values({
          id: userId,
          name: dto.name,
          email: dto.email,
          emailVerified: true,
          role: dto.role || Role.USER,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await tx.insert(account).values({
        id: uuidv7(),
        userId,
        accountId: userId,
        providerId: 'credential',
        password: passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return insertedUser;
    });

    await this.searchSyncService.sync(userSearchable, newUser);

    return new UserEntity(newUser);
  }

  async findAll(query: FindUsersRequest) {
    const parsed = parseSpatieQuery(query as unknown as Record<string, unknown>);
    // 顶层 role 为历史兼容参数：等价 filter[role]=<role>，已显式过滤时不覆盖
    if (query.role && !parsed.filters.some((filter) => filter.field === 'role')) {
      parsed.filters.push({ field: 'role', operator: '=', values: [query.role] });
    }

    const { rows, total } = await paginateSpatieQuery(this.db, user, parsed, {
      filterableColumns: {
        role: user.role,
        createdAt: user.createdAt,
      },
      partialColumns: {
        name: user.name,
        email: user.email,
      },
      searchableColumns: [user.name, user.email],
      sortableColumns: {
        createdAt: user.createdAt,
        name: user.name,
        email: user.email,
      },
      defaultOrderBy: desc(user.createdAt),
    });

    const pageMeta = new PageMetaResource({ page: parsed.page, pageSize: parsed.pageSize }, total);
    return new PaginatedResultResource(
      rows.map((row) => new UserEntity(row)),
      pageMeta,
    );
  }

  async findOne(id: string) {
    const foundUser = await this.db.query.user.findFirst({
      where: eq(user.id, id),
    });
    if (!foundUser) {
      throw new NotFoundException('User not found');
    }
    return new UserEntity(foundUser);
  }

  /** 原子更新用户 — 显式构造类型安全的更新对象，消除 as 类型断言 */
  async update(id: string, dto: UpdateUserRequest) {
    // 邮箱唯一性预检查 — 防止修改为已被其他用户占用的邮箱
    if (dto.email !== undefined) {
      const existing = await this.db.query.user.findFirst({
        where: eq(user.email, dto.email),
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Email is already in use by another user');
      }
    }

    return this.applyUserUpdate(id, { ...pick(dto, ['name', 'email']), updatedAt: new Date() });
  }

  /**
   * 变更用户角色 —— 三层防护：
   * 1. 路由层 `@Roles(ADMIN, SUPER_ADMIN)` 拒绝 OPERATOR 进入；
   * 2. 服务层校验「不得自改」与「不得越级授予」；
   * 3. 服务层还校验目标**当前**角色不得等于/高于调用者，
   *    否则 ADMIN 可把一个 SUPER_ADMIN 降级为 USER（同级互相降权）= 变相提权。
   */
  async changeRole(actor: { id: string; role: Role }, id: string, role: Role) {
    if (actor.id === id) {
      throw new ForbiddenException('Cannot change your own role');
    }

    const target = await this.db.query.user.findFirst({
      columns: { id: true, role: true },
      where: eq(user.id, id),
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }

    const actorRank = rankOf(actor.role);
    const currentRank = rankOf(target.role);
    const nextRank = ROLE_RANK[role];
    // 同级操作默认拒绝：仅 SUPER_ADMIN 之间可以互相委任/降级
    const peerSuperAdmin = actor.role === Role.SUPER_ADMIN && target.role === Role.SUPER_ADMIN;

    if (currentRank >= actorRank && !peerSuperAdmin) {
      throw new ForbiddenException('Cannot modify a user at or above your own role');
    }
    if (nextRank >= actorRank && !(actor.role === Role.SUPER_ADMIN && role === Role.SUPER_ADMIN)) {
      throw new ForbiddenException('Cannot assign a role at or above your own');
    }

    return this.applyUserUpdate(id, { role, updatedAt: new Date() });
  }

  /** 内部方法：原子更新并回查 → 未命中抛 404 → 同步搜索引擎（消除 update/changeRole 的重复流程） */
  private async applyUserUpdate(id: string, patch: Partial<typeof user.$inferInsert>): Promise<UserEntity> {
    const [updatedUser] = await this.db.update(user).set(patch).where(eq(user.id, id)).returning();

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    await this.searchSyncService.sync(userSearchable, updatedUser);
    return new UserEntity(updatedUser);
  }

  /** 原子删除 — 一步完成删+查，消除竞态条件 */
  async remove(id: string): Promise<void> {
    const [deletedUser] = await this.db.delete(user).where(eq(user.id, id)).returning();
    if (!deletedUser) {
      throw new NotFoundException('User not found');
    }
    await this.searchSyncService.remove(userSearchable, id);
  }

  /** 全文搜索用户（支持 Meilisearch 检索与角色过滤，保持相关度排序） */
  async search(query: SearchUsersRequest) {
    const result = await this.searchService.searchModel(userSearchable, {
      query: query.q,
      filter: query.role ? `role = "${query.role}"` : undefined,
      page: query.page,
      limit: query.pageSize,
      hydrate: true,
    });

    const pageMeta = new PageMetaResource({ page: result.page, pageSize: result.limit }, result.total);

    return new PaginatedResultResource(
      result.items.map((u) => new UserEntity(u as typeof user.$inferSelect)),
      pageMeta,
    );
  }
}
