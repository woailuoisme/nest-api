import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { MediaService } from '@/common/media/media.service';
import type { UploadedFile } from '@/common/storage/interfaces/upload.interface';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { users } from '@/database/drizzle/schema';
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
    @InjectDb() private readonly db: DrizzleDB,
    private readonly mediaService: MediaService,
  ) {}

  async findOne(id: number) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return new UserEntity(user);
  }

  /**
   * 原子更新头像 — 委托 MediaService.storeWithCompensation 自动接管存储、WebP 优化与事务补偿：
   * 1. 预检用户存在；
   * 2. WebP 优化转码存盘 + 数据库更新；
   * 3. 失败自动回滚新写入文件，成功自动回收旧头像（支持 Local 与 S3）。
   */
  async updateAvatar(id: number, file: UploadedFile) {
    const current = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!current) {
      throw new NotFoundException('User not found');
    }

    return this.mediaService.storeWithCompensation(
      file,
      { prefix: 'avatars', convertToWebp: true, webpQuality: 85 },
      async (saved) => {
        const [user] = await this.db
          .update(users)
          .set({ avatarUrl: saved.url, updatedAt: new Date() })
          .where(eq(users.id, id))
          .returning();

        if (!user) {
          throw new NotFoundException('User not found');
        }

        return new UserEntity(user);
      },
      { oldUrl: current.avatarUrl },
    );
  }
}
