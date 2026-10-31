import { PasswordHasher } from '@nestjs/authentication';
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { desc, eq } from 'drizzle-orm';
import { pick } from 'es-toolkit';
import { v7 as uuidv7 } from 'uuid';

import { Role } from '@/common/constants/roles';
import { PageMetaResource, PaginatedResultResource } from '@/common/dto/pagination.dto';
import { MediaService } from '@/common/media/media.service';
import { parseSpatieQuery } from '@/common/query/spatie-query';
import { SearchSyncService } from '@/common/search/search-sync.service';
import { SearchService } from '@/common/search/search.service';
import type { Database } from '@/database/drizzle/database';
import { paginateSpatieQuery } from '@/database/drizzle/drizzle-pagination';
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
 * 仅存在于历史认证系统的角色。直接下标取值会得到 `undefined`，而 `undefined >= n` 为 false，
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
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly searchService: SearchService,
    private readonly searchSyncService: SearchSyncService,
    private readonly passwordHasher: PasswordHasher,
    private readonly mediaService: MediaService,
  ) {}

  async create(actor: { id: string; role: Role }, dto: CreateUserRequest) {
    const role = dto.role ?? Role.USER;
    this.assertAssignable(actor.role, role);

    const existing = await this.db.query.user.findFirst({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const userId = uuidv7();
    const passwordHash = await this.passwordHasher.hash(dto.password);
    // user 与 account 属于同一次创建：共享同一时间戳，避免两行出现毫秒级漂移
    const now = new Date();

    const newUser = await this.db.transaction(async (tx) => {
      const [insertedUser] = await tx
        .insert(user)
        .values({
          id: userId,
          name: dto.name,
          email: dto.email,
          emailVerified: true,
          role,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await tx.insert(account).values({
        id: uuidv7(),
        userId,
        accountId: userId,
        providerId: 'credential',
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });

      return insertedUser;
    });

    await this.searchSyncService.sync(userSearchable, newUser);

    return this.toEntity(newUser);
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

    return this.toPage(
      rows.map((row) => this.toEntity(row)),
      parsed.page,
      parsed.pageSize,
      total,
    );
  }

  async findOne(id: string) {
    const foundUser = await this.db.query.user.findFirst({
      where: { id },
    });
    if (!foundUser) {
      throw new NotFoundException('User not found');
    }
    return this.toEntity(foundUser);
  }

  /** 原子更新用户 — 邮箱变更额外要求管理级别与严格低于目标角色（防账号接管） */
  async update(actor: { id: string; role: Role }, id: string, dto: UpdateUserRequest) {
    const target = await this.findTarget(id);
    if (actor.id !== id) {
      this.assertCanManageTarget(actor.role, target.role);
    }

    if (dto.email !== undefined) {
      this.assertCanChangeEmail(actor, id, target.role);
      const existing = await this.db.query.user.findFirst({
        where: { email: dto.email },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Email is already in use by another user');
      }
    }

    const patch = {
      ...pick(dto, ['name', 'email']),
      ...(dto.email !== undefined ? { emailVerified: false } : {}),
      updatedAt: new Date(),
    };
    return this.applyUserUpdate(id, patch);
  }

  /**
   * 变更用户角色 —— 三层防护：
   * 1. 路由层 `@Can(AdminPolicy, 'changeUserRole')` 拒绝 OPERATOR 进入（SUPER_ADMIN 由 before 直通）；
   * 2. 服务层校验「不得自改」与「不得越级授予」；
   * 3. 服务层还校验目标**当前**角色不得等于/高于调用者，
   *    否则 ADMIN 可把一个 SUPER_ADMIN 降级为 USER（同级互相降权）= 变相提权。
   */
  async changeRole(actor: { id: string; role: Role }, id: string, role: Role) {
    if (actor.id === id) {
      throw new ForbiddenException('Cannot change your own role');
    }

    const target = await this.findTarget(id);
    // 目标不得同级/更高（防同级互降），下一角色不得同级/更高（防越级授予）
    this.assertCanManageTarget(actor.role, target.role);
    this.assertAssignable(actor.role, role);

    return this.applyUserUpdate(id, { role, updatedAt: new Date() });
  }

  /** 内部方法：原子更新并回查 → 未命中抛 404 → 同步搜索引擎（消除 update/changeRole 的重复流程） */
  private async applyUserUpdate(id: string, patch: Partial<typeof user.$inferInsert>): Promise<UserEntity> {
    const [updatedUser] = await this.db.update(user).set(patch).where(eq(user.id, id)).returning();

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    await this.searchSyncService.sync(userSearchable, updatedUser);
    return this.toEntity(updatedUser);
  }

  /** 原子删除 — 禁止自删，且不得删除同级/更高角色（SUPER_ADMIN 之间除外） */
  async remove(actor: { id: string; role: Role }, id: string): Promise<void> {
    if (actor.id === id) {
      throw new ForbiddenException('Cannot delete your own account');
    }
    const target = await this.findTarget(id);
    this.assertCanManageTarget(actor.role, target.role);

    const [deletedUser] = await this.db.delete(user).where(eq(user.id, id)).returning();
    if (!deletedUser) {
      throw new NotFoundException('User not found');
    }
    if (deletedUser.avatarPath) {
      await this.mediaService.deleteStored(deletedUser.avatarPath).catch((err: unknown) => {
        this.logger.warn(`清理已删除用户头像文件失败 [${deletedUser.avatarPath}]: ${String(err)}`);
      });
    }
    await this.searchSyncService.remove(userSearchable, id);
  }

  /** 代他人改邮箱：仅管理员可操作，且目标角色必须严格低于自己（邮箱是账号恢复入口） */
  private assertCanChangeEmail(actor: { id: string; role: Role }, targetId: string, targetRole: string | null): void {
    if (actor.id === targetId) return;

    if (rankOf(actor.role) < ROLE_RANK[Role.ADMIN]) {
      throw new ForbiddenException('Only administrators can change an email address');
    }
    if (rankOf(targetRole) >= rankOf(actor.role)) {
      throw new ForbiddenException('Cannot change the email of a user at or above your own role');
    }
  }

  /** 授予角色：不得授予同级/更高角色（SUPER_ADMIN 委任同级除外） */
  private assertAssignable(actorRole: Role, role: Role): void {
    const actorRank = rankOf(actorRole);
    const nextRank = ROLE_RANK[role];
    const peerSuperAdmin = actorRole === Role.SUPER_ADMIN && role === Role.SUPER_ADMIN;
    if (nextRank >= actorRank && !peerSuperAdmin) {
      throw new ForbiddenException('Cannot assign a role at or above your own');
    }
  }

  /** 管理目标：不得操作同级/更高角色（SUPER_ADMIN 之间除外） */
  private assertCanManageTarget(actorRole: Role, targetRole: string | null): void {
    const actorRank = rankOf(actorRole);
    const targetRank = rankOf(targetRole);
    const peerSuperAdmin = actorRole === Role.SUPER_ADMIN && targetRole === Role.SUPER_ADMIN;
    if (targetRank >= actorRank && !peerSuperAdmin) {
      throw new ForbiddenException('Cannot modify a user at or above your own role');
    }
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

    return this.toPage(
      result.items.map((u) => this.toEntity(u as typeof user.$inferSelect)),
      result.page,
      result.limit,
      result.total,
    );
  }

  /** 将数据库 user 行显式组装为附带 imgproxy 优化 URL 的领域实体 */
  private toEntity(row: typeof user.$inferSelect): UserEntity {
    const avatarUrl = row.avatarPath ? this.mediaService.url(row.avatarPath).preset('avatar').build() : null;

    return new UserEntity({
      ...row,
      avatarPath: row.avatarPath,
      avatarUrl,
    });
  }

  /** 取目标用户的最小投影（id + 当前角色）；不存在统一 404 */
  private async findTarget(id: string): Promise<{ id: string; role: string | null }> {
    const target = await this.db.query.user.findFirst({
      columns: { id: true, role: true },
      where: { id },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    return target;
  }

  /** 统一分页信封（列表与全文搜索共用，避免两处各拼一次 meta） */
  private toPage(
    items: UserEntity[],
    page: number,
    pageSize: number,
    total: number,
  ): PaginatedResultResource<UserEntity> {
    return new PaginatedResultResource(items, new PageMetaResource({ page, pageSize }, total));
  }
}
