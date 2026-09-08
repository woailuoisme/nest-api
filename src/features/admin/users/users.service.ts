import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hashPassword } from 'better-auth/crypto';
import { desc, eq } from 'drizzle-orm';
import { pick } from 'es-toolkit';
import { v7 as uuidv7 } from 'uuid';
import { Role } from '@/common/constants/roles';
import { PageMetaResource, PaginatedResultResource } from '@/common/dto/pagination.dto';
import { parseSpatieQuery } from '@/common/query/spatie-query';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { paginateSpatieQuery } from '@/database/drizzle/drizzle-pagination';
import { account, user } from '@/database/drizzle/schema';
import { CreateUserRequest, FindUsersRequest, UpdateUserRequest, UserEntity } from './users.dto';

@Injectable()
export class UsersService {
  constructor(@InjectDb() private readonly db: DrizzleDB) {}

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

    return new UserEntity(newUser as unknown as Partial<UserEntity>);
  }

  async findAll(query: FindUsersRequest) {
    const parsed = parseSpatieQuery(query as unknown as Record<string, unknown>);
    if (query.role && !parsed.filters.role) {
      parsed.filters.role = query.role;
    }

    const { rows, total } = await paginateSpatieQuery(this.db, user, parsed, {
      filterableColumns: {
        role: user.role,
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
      rows.map((row) => new UserEntity(row as unknown as Partial<UserEntity>)),
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
    return new UserEntity(foundUser as unknown as Partial<UserEntity>);
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

    const updateData: Partial<typeof user.$inferInsert> = {
      ...pick(dto, ['name', 'email']),
      updatedAt: new Date(),
    };

    const [updatedUser] = await this.db.update(user).set(updateData).where(eq(user.id, id)).returning();

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }
    return new UserEntity(updatedUser as unknown as Partial<UserEntity>);
  }

  /** 变更用户角色 — 仅具备权限的管理员可调用 */
  async changeRole(id: string, role: Role) {
    const [updatedUser] = await this.db
      .update(user)
      .set({ role, updatedAt: new Date() })
      .where(eq(user.id, id))
      .returning();

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }
    return new UserEntity(updatedUser as unknown as Partial<UserEntity>);
  }

  /** 原子删除 — 一步完成删+查，消除竞态条件 */
  async remove(id: string): Promise<void> {
    const [deletedUser] = await this.db.delete(user).where(eq(user.id, id)).returning();
    if (!deletedUser) {
      throw new NotFoundException('User not found');
    }
  }
}
