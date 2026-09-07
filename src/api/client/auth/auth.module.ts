import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { QueuesModule } from '@/queues/queues.module';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthTokenManager } from './auth-token.manager';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [PassportModule, JwtModule.register({}), QueuesModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthTokenManager,
    JwtStrategy,
    JwtAuthGuard,
    // OAuth 策略直接注册（类内已对缺失凭据做 'disabled' 占位 + warn 兜底）
    GoogleStrategy,
  ],
  exports: [AuthService, AuthTokenManager, JwtAuthGuard],
})
export class AuthModule {}
