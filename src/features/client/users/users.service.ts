import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';

import { MediaService } from '@/common/media/media.service';
import type { UploadedFile } from '@/common/storage/interfaces/upload.interface';
import type { Database } from '@/database/drizzle/database';
import { user } from '@/database/drizzle/schema';

import { UserEntity } from './users.dto';

/**
 * 用户自助服务（前端 API）
 *
 * 仅承载当前用户自助面：查询用户详情与更新自己的头像。
 * 管理面（CRUD/角色变更）见 admin/users 的 UsersService，两者相互独立、零依赖。
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly mediaService: MediaService,
  ) {}

  async findOne(id: string): Promise<UserEntity> {
    const foundUser = await this.db.query.user.findFirst({
      where: { id },
    });
    if (!foundUser) {
      throw new NotFoundException('User not found');
    }
    return this.toEntity(foundUser);
  }

  /**
   * 原子更新头像 — 委托 MediaService.storeWithCompensation 自动接管存储与事务补偿：
   * 1. 预检用户存在；
   * 2. 流式直存原始主图到 avatars 目录 + 数据库更新 avatar_path 相对路径；
   * 3. 失败自动回滚新写入文件，成功自动回收旧头像相对路径文件；
   * 4. 返回组装好 imgproxy JIT 签名 URL 的 UserEntity。
   */
  async updateAvatar(id: string, file: UploadedFile): Promise<UserEntity> {
    const current = await this.findOne(id);

    return this.mediaService.storeWithCompensation(
      file,
      { prefix: 'avatars' },
      async (saved) => {
        const [updatedUser] = await this.db
          .update(user)
          .set({ avatarPath: saved.path, updatedAt: new Date() })
          .where(eq(user.id, id))
          .returning();

        if (!updatedUser) {
          throw new NotFoundException('User not found');
        }

        return this.toEntity(updatedUser);
      },
      current.avatarPath ? { oldPath: current.avatarPath } : undefined,
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
}
