import { PasswordHasher } from '@nestjs/authentication';
/**
 * UsersService 单元测试
 *
 * 覆盖：用户 CRUD、分页搜索、头像更新
 */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { range } from 'es-toolkit';
import { createMockDrizzleDb } from 'tests/mocks/drizzle.mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Role } from '@/common/constants/roles';
import { SearchService, SearchSyncService } from '@/common/search';
import { paginateQuery, paginateSpatieQuery } from '@/database/drizzle/drizzle-pagination';
import { UserEntity } from '@/features/admin/users/users.dto';
import { UsersService } from '@/features/admin/users/users.service';

/** 模拟分页助手 */
vi.mock('@/database/drizzle/drizzle-pagination', () => ({
  paginateQuery: vi.fn(),
  paginateSpatieQuery: vi.fn(),
}));

describe('UsersService (Admin)', () => {
  let usersService: UsersService;
  let db: ReturnType<typeof createMockDrizzleDb>;
  let searchService: { searchModel: ReturnType<typeof vi.fn> };
  let searchSyncService: {
    sync: ReturnType<typeof vi.fn>;
    syncById: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  const mockUser = {
    id: 'user-uuid-1',
    name: '张三',
    email: 'zhangsan@example.com',
    role: 'USER',
    avatarUrl: null,
    emailVerified: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const actor = { id: 'actor-uuid-1', role: Role.SUPER_ADMIN };

  beforeEach(async () => {
    db = createMockDrizzleDb();
    searchService = {
      searchModel: vi.fn(),
    };
    searchSyncService = {
      sync: vi.fn().mockResolvedValue(undefined),
      syncById: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getDrizzleToken(), useValue: db },
        { provide: SearchService, useValue: searchService },
        { provide: SearchSyncService, useValue: searchSyncService },
        {
          provide: PasswordHasher,
          useValue: { hash: vi.fn((plain: string) => Promise.resolve(`hashed:${plain}`)) },
        },
      ],
    }).compile();

    usersService = module.get(UsersService);
  });

  describe('create() — 创建用户', () => {
    const createDto = {
      name: '李四',
      email: 'lisi@example.com',
      password: 'strongPassword1',
    };

    it('应创建用户并返回 UserEntity', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);
      db._stubs.insertReturning.mockResolvedValue([{ ...mockUser, ...createDto, emailVerifiedAt: undefined }]);

      const result = await usersService.create(actor, createDto);

      expect(result).toHaveProperty('name', '李四');
      expect(result).toHaveProperty('email', 'lisi@example.com');
      expect(db.insert).toHaveBeenCalledTimes(2);
    });

    it('应使用哈希后的密码创建用户', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);
      db._stubs.insertReturning.mockResolvedValue([{ ...mockUser, ...createDto }]);

      await usersService.create(actor, createDto);

      const userInsertData = db._stubs.insertValues.mock.calls[0][0];
      const accountInsertData = db._stubs.insertValues.mock.calls[1][0];
      expect(userInsertData.email).toBe(createDto.email);
      expect(accountInsertData.password).toBe('hashed:strongPassword1');
      expect(accountInsertData.providerId).toBe('credential');
    });

    it('邮箱已存在时应抛出 ConflictException', async () => {
      db._stubs.findFirstUser.mockResolvedValue(mockUser);

      await expect(usersService.create(actor, createDto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('可选 role 参数应生效', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);
      db._stubs.insertReturning.mockResolvedValue([{ ...mockUser, role: 'ADMIN' }]);

      await usersService.create(actor, { ...createDto, role: 'ADMIN' as any });

      expect(db._stubs.insertValues.mock.calls[0][0].role).toBe('ADMIN');
    });
  });

  describe('create() — 越权防护', () => {
    it('ADMIN 不得创建 SUPER_ADMIN', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);

      await expect(
        usersService.create(
          { id: 'admin-1', role: Role.ADMIN },
          { name: '越权', email: 'escalate@example.com', password: 'Password123', role: Role.SUPER_ADMIN },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findAll() — 分页列表', () => {
    it('默认参数应返回第一页 20 条', async () => {
      vi.mocked(paginateSpatieQuery).mockResolvedValue({
        rows: range(1, 21).map((id) => ({ ...mockUser, id: `uuid-${id}` })),
        total: 50,
      } as any);

      const result = await usersService.findAll({});

      expect(result.items).toHaveLength(20);
      expect(result.meta.total).toBe(50);
      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(20);
    });

    it('自定义分页参数应正确透传', async () => {
      vi.mocked(paginateSpatieQuery).mockResolvedValue({ rows: [mockUser], total: 1 } as any);

      await usersService.findAll({ page: 3, pageSize: 20 });

      const parsedQuery = vi.mocked(paginateSpatieQuery).mock.calls[0][2];
      expect(parsedQuery.page).toBe(3);
      expect(parsedQuery.pageSize).toBe(20);
    });

    it('空结果应正确处理', async () => {
      vi.mocked(paginateSpatieQuery).mockResolvedValue({ rows: [], total: 0 } as any);

      const result = await usersService.findAll({});

      expect(result.items).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(1);
    });

    it('返回的列表元素经 UserEntity 序列化后应安全剥离 passwordHash', async () => {
      vi.mocked(paginateSpatieQuery).mockResolvedValue({ rows: [mockUser], total: 1 } as any);

      const result = await usersService.findAll({});

      expect(result.items[0]).toBeInstanceOf(UserEntity);
      expect(result.items[0]).not.toHaveProperty('passwordHash');
      expect(result.items[0]).toHaveProperty('id', 'user-uuid-1');
      expect(result.items[0]).toHaveProperty('email', 'zhangsan@example.com');
    });
  });

  describe('findOne() — 查找单个用户', () => {
    it('应返回指定 ID 的用户', async () => {
      db._stubs.findFirstUser.mockResolvedValue(mockUser);

      const result = await usersService.findOne('user-uuid-1');

      expect(result.id).toBe('user-uuid-1');
      expect(result).toHaveProperty('name', '张三');
    });

    it('用户不存在时应抛出 NotFoundException', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);

      await expect(usersService.findOne('non-existent')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update() — 更新用户', () => {
    it('应更新用户并返回 UserEntity', async () => {
      db._stubs.findFirstUser.mockResolvedValue({ id: 'user-uuid-1', role: Role.USER });
      db._stubs.updateReturning.mockResolvedValue([{ ...mockUser, name: '张三三' }]);

      const result = await usersService.update(actor, 'user-uuid-1', { name: '张三三' });

      expect(result.name).toBe('张三三');
    });

    it('更新邮箱时若已被他人占用应抛出 ConflictException', async () => {
      db._stubs.findFirstUser
        .mockResolvedValueOnce({ id: 'user-uuid-1', role: Role.USER })
        .mockResolvedValueOnce({ ...mockUser, id: 'user-uuid-2', email: 'other@example.com' });

      await expect(usersService.update(actor, 'user-uuid-1', { email: 'other@example.com' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('管理员可更新自己的资料（不得自删）', async () => {
      db._stubs.findFirstUser.mockResolvedValue({ id: actor.id, role: actor.role });
      db._stubs.updateReturning.mockResolvedValue([{ ...mockUser, name: '新名字' }]);

      const result = await usersService.update(actor, actor.id, { name: '新名字' });

      expect(result.name).toBe('新名字');
    });

    it('OPERATOR 不得修改邮箱', async () => {
      db._stubs.findFirstUser.mockResolvedValue({ id: 'user-uuid-1', role: Role.USER });

      await expect(
        usersService.update({ id: 'op-1', role: Role.OPERATOR }, 'user-uuid-1', { email: 'x@example.com' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('用户不存在时应抛出 NotFoundException', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);

      await expect(usersService.update(actor, 'non-existent', { name: 'test' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('changeRole() — 变更用户角色', () => {
    /** 具备委任权限的调用者（勿使用 ADMIN：同/超权一律拒绝） */
    const superAdmin = { id: 'admin-uuid-1', role: Role.SUPER_ADMIN };

    it('应写入目标角色并返回 UserEntity', async () => {
      db._stubs.findFirstUser.mockResolvedValue({ id: 'user-uuid-1', role: Role.USER });
      db._stubs.updateReturning.mockResolvedValue([{ ...mockUser, role: 'ADMIN' }]);

      const result = await usersService.changeRole(superAdmin, 'user-uuid-1', Role.ADMIN);

      expect(db._stubs.updateSet).toHaveBeenCalledWith(expect.objectContaining({ role: Role.ADMIN }));
      expect(result.role).toBe(Role.ADMIN);
    });

    it('用户不存在时应抛出 NotFoundException', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);

      await expect(usersService.changeRole(superAdmin, 'non-existent', Role.ADMIN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(db._stubs.updateReturning).not.toHaveBeenCalled();
    });

    it('禁止变更自己的角色', async () => {
      await expect(usersService.changeRole(superAdmin, superAdmin.id, Role.USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('禁止授予同级或更高角色（防提权）', async () => {
      db._stubs.findFirstUser.mockResolvedValue({ id: 'user-uuid-1', role: Role.USER });
      const admin = { id: 'admin-uuid-2', role: Role.ADMIN };
      await expect(usersService.changeRole(admin, 'user-uuid-1', Role.SUPER_ADMIN)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(usersService.changeRole(admin, 'user-uuid-1', Role.ADMIN)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('禁止降级同级或更高角色的账号（否则 ADMIN 可搞降 SUPER_ADMIN）', async () => {
      db._stubs.findFirstUser.mockResolvedValue({ id: 'target-uuid', role: Role.SUPER_ADMIN });
      const admin = { id: 'admin-uuid-2', role: Role.ADMIN };

      await expect(usersService.changeRole(admin, 'target-uuid', Role.USER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('同级 ADMIN 之间也不得互相变更', async () => {
      db._stubs.findFirstUser.mockResolvedValue({ id: 'target-uuid', role: Role.ADMIN });
      const admin = { id: 'admin-uuid-2', role: Role.ADMIN };

      await expect(usersService.changeRole(admin, 'target-uuid', Role.USER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('SUPER_ADMIN 可以委任/降级同级 SUPER_ADMIN', async () => {
      db._stubs.findFirstUser.mockResolvedValue({ id: 'target-uuid', role: Role.SUPER_ADMIN });
      db._stubs.updateReturning.mockResolvedValue([{ ...mockUser, role: Role.SUPER_ADMIN }]);

      const result = await usersService.changeRole(superAdmin, 'target-uuid', Role.SUPER_ADMIN);

      expect(result.role).toBe(Role.SUPER_ADMIN);
    });

    it('目标角色为未知值/null 时 fail-closed（不得静默当作最低权重放行）', async () => {
      const admin = { id: 'admin-uuid-2', role: Role.ADMIN };

      for (const role of [null, 'ghost_role']) {
        db._stubs.findFirstUser.mockResolvedValue({ id: 'target-uuid', role });
        await expect(usersService.changeRole(admin, 'target-uuid', Role.USER)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      }
    });
  });

  describe('remove() — 删除用户', () => {
    it('应原子删除用户', async () => {
      db._stubs.findFirstUser.mockResolvedValue({ id: 'user-uuid-1', role: Role.USER });
      db._stubs.deleteReturning.mockResolvedValue([mockUser]);

      const result = await usersService.remove(actor, 'user-uuid-1');

      expect(result).toBeUndefined();
      expect(db.delete).toHaveBeenCalled();
    });

    it('用户不存在时应抛出 NotFoundException', async () => {
      db._stubs.findFirstUser.mockResolvedValue(null);

      await expect(usersService.remove(actor, 'non-existent')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ADMIN 不得删除 SUPER_ADMIN', async () => {
      db._stubs.findFirstUser.mockResolvedValue({ id: 'super-1', role: Role.SUPER_ADMIN });

      await expect(usersService.remove({ id: 'admin-1', role: Role.ADMIN }, 'super-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('search() — 全文搜索用户', () => {
    it('应通过 searchService.searchModel 执行检索并返回分页资源', async () => {
      searchService.searchModel.mockResolvedValue({
        items: [mockUser],
        total: 1,
        page: 1,
        limit: 20,
        processingTimeMs: 5,
      });

      const result = await usersService.search({ q: '张三', role: Role.USER, page: 1, pageSize: 20 });

      expect(searchService.searchModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          query: '张三',
          filter: 'role = "USER"',
          page: 1,
          limit: 20,
          hydrate: true,
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });
});
