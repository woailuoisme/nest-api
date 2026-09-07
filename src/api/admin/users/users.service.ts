import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { pick } from 'es-toolkit';
import { PAGINATION } from '@/common/constants/app.constants';
import type { Role } from '@/common/constants/roles';
import { PageMetaResource, PaginatedResultResource } from '@/common/dto/pagination.dto';
import { Hash } from '@/common/utils/hash.util';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { paginateQuery } from '@/database/drizzle/drizzle-pagination';
import { users } from '@/database/drizzle/schema';
import { CreateUserRequest, FindUsersRequest, UpdateUserRequest, UserEntity } from './users.dto';

@Injectable()
export class UsersService {
  constructor(@InjectDb() private readonly db: DrizzleDB) {}

  async create(dto: CreateUserRequest) {
    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, dto.email),
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await Hash.make(dto.password);

    const [user] = await this.db
      .insert(users)
      .values({
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: dto.role,
      })
      .returning();

    return new UserEntity(user);
  }

  async findAll(query: FindUsersRequest) {
    const { page = PAGINATION.DEFAULT_PAGE, pageSize = PAGINATION.DEFAULT_PER_PAGE, search, role } = query;

    const conditions = [];
    if (role) {
      conditions.push(eq(users.role, role));
    }
    if (search) {
      conditions.push(or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`)));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const { rows, total } = await paginateQuery(this.db, users, {
      page,
      pageSize,
      where,
      orderBy: desc(users.createdAt),
    });

    const pageMeta = new PageMetaResource({ page, pageSize }, total);
    return new PaginatedResultResource(
      rows.map((user) => new UserEntity(user)),
      pageMeta,
    );
  }

  async findOne(id: number) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return new UserEntity(user);
  }

  /** 原子更新用户 — 显式构造类型安全的更新对象，消除 as 类型断言 */
  async update(id: number, dto: UpdateUserRequest) {
    // 邮箱唯一性预检查 — 防止修改为已被其他用户占用的邮箱
    if (dto.email !== undefined) {
      const existing = await this.db.query.users.findFirst({
        where: eq(users.email, dto.email),
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Email is already in use by another user');
      }
    }

    const updateData: Partial<typeof users.$inferInsert> = {
      ...pick(dto, ['name', 'email']),
      updatedAt: new Date(),
    };

    const [user] = await this.db.update(users).set(updateData).where(eq(users.id, id)).returning();

    if (!user) {
      throw new NotFoundException('User not found');
    }
    return new UserEntity(user);
  }

  /** 变更用户角色 — 仅 ADMIN 可调用（走独立端点），不暴露在 UserUpdate 权限面内，杜绝提权 */
  async changeRole(id: number, role: Role) {
    const [user] = await this.db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id)).returning();

    if (!user) {
      throw new NotFoundException('User not found');
    }
    return new UserEntity(user);
  }

  /** 原子删除 — 一步完成删+查，消除竞态条件 */
  async remove(id: number) {
    const [user] = await this.db.delete(users).where(eq(users.id, id)).returning();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { message: 'User deleted successfully' };
  }
}
