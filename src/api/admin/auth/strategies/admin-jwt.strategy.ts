import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { eq } from 'drizzle-orm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AdminStatus } from '@/common/constants/roles';
import type { EnvConfig } from '@/config/env.validation';
import { type DrizzleDB, InjectDb } from '@/database/drizzle/drizzle.service';
import { adminUsers } from '@/database/drizzle/schema';

export interface AdminJwtPayload {
  sub: number | string;
  email: string;
  role: string;
  guard: 'admin';
}

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    @Inject(ConfigService) config: ConfigService<EnvConfig, true>,
    @InjectDb() private readonly db: DrizzleDB,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AdminJwtPayload) {
    if (payload.guard !== 'admin') {
      throw new UnauthorizedException('Invalid token guard: admin token required');
    }

    const admin = await this.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, Number(payload.sub)),
    });

    if (!admin) {
      throw new UnauthorizedException('Administrator account not found');
    }

    if (admin.status !== AdminStatus.ACTIVE) {
      throw new UnauthorizedException('Administrator account is disabled');
    }

    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      avatarUrl: admin.avatarUrl,
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    };
  }
}
