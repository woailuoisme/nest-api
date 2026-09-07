import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { pick } from 'es-toolkit';
import { PAGINATION } from '@/common/constants/app.constants';
import { PageMetaResource, PaginatedResultResource } from '@/common/dto/pagination.dto';
import { Hash } from '@/common/utils/hash.util';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { paginateQuery } from '@/database/drizzle/drizzle-pagination';
import { adminRefreshTokens, adminUsers } from '@/database/drizzle/schema';
import type { AdminItemResponse, AdminQueryRequest, CreateAdminRequest, UpdateAdminRequest } from './admins.dto';

@Injectable()
export class AdminsService {
  constructor(@InjectDb() private readonly db: DrizzleDB) {}

  async findAll(query: AdminQueryRequest): Promise<PaginatedResultResource<AdminItemResponse>> {
    const { page = PAGINATION.DEFAULT_PAGE, pageSize = PAGINATION.DEFAULT_PER_PAGE, search, role, status } = query;

    const conditions = [];

    if (search) {
      conditions.push(or(ilike(adminUsers.name, `%${search}%`), ilike(adminUsers.email, `%${search}%`)));
    }
    if (role) {
      conditions.push(eq(adminUsers.role, role));
    }
    if (status) {
      conditions.push(eq(adminUsers.status, status));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const { rows, total } = await paginateQuery(this.db, adminUsers, {
      page,
      pageSize,
      where,
      orderBy: desc(adminUsers.createdAt),
    });

    const mappedItems: AdminItemResponse[] = rows.map((item) => this.mapToResponse(item));

    const pageMeta = new PageMetaResource({ page, pageSize }, total);
    return new PaginatedResultResource(mappedItems, pageMeta);
  }

  async findById(id: number): Promise<AdminItemResponse> {
    const admin = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, id),
    });

    if (!admin) {
      throw new NotFoundException(`Administrator with ID ${id} not found`);
    }

    return this.mapToResponse(admin);
  }

  async create(dto: CreateAdminRequest): Promise<AdminItemResponse> {
    const existing = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.email, dto.email),
    });

    if (existing) {
      throw new ConflictException('Admin email already exists');
    }

    const passwordHash = await Hash.make(dto.password);

    const [admin] = await this.db
      .insert(adminUsers)
      .values({
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: dto.role,
        status: dto.status,
        avatarUrl: dto.avatarUrl ?? null,
      })
      .returning();

    return this.mapToResponse(admin);
  }

  async update(id: number, dto: UpdateAdminRequest): Promise<AdminItemResponse> {
    const existing = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, id),
    });

    if (!existing) {
      throw new NotFoundException(`Administrator with ID ${id} not found`);
    }

    const updates: Partial<typeof adminUsers.$inferInsert> = {
      ...pick(dto, ['name', 'role', 'status', 'avatarUrl']),
      updatedAt: new Date(),
    };

    if (dto.password) {
      updates.passwordHash = await Hash.make(dto.password);
      // 密码重置时吊销该管理员的全部有效 refresh token
      await this.db
        .update(adminRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(adminRefreshTokens.adminUserId, id));
    }

    const [updated] = await this.db.update(adminUsers).set(updates).where(eq(adminUsers.id, id)).returning();

    return this.mapToResponse(updated);
  }

  private mapToResponse(admin: typeof adminUsers.$inferSelect): AdminItemResponse {
    return {
      ...pick(admin, ['id', 'name', 'email', 'role', 'status', 'avatarUrl']),
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
      createdAt: admin.createdAt.toISOString(),
      updatedAt: admin.updatedAt.toISOString(),
    };
  }

  async delete(id: number, currentAdminId: number): Promise<void> {
    if (id === currentAdminId) {
      throw new BadRequestException('Cannot delete your own administrator account');
    }

    const existing = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, id),
    });

    if (!existing) {
      throw new NotFoundException(`Administrator with ID ${id} not found`);
    }

    await this.db.delete(adminUsers).where(eq(adminUsers.id, id));
  }
}
