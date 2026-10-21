import { Module, type OnModuleInit } from '@nestjs/common';

import { setBetterAuthMailDispatcher } from '@/common/auth/mail-dispatcher';
import { BetterAuthGuard } from '@/common/guards/better-auth.guard';
import { JobsModule } from '@/jobs/jobs.module';
import { MailJobs } from '@/jobs/mail/mail.jobs';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [JobsModule],
  controllers: [AuthController],
  providers: [AuthService, BetterAuthGuard],
  exports: [AuthService, BetterAuthGuard],
})
export class AuthModule implements OnModuleInit {
  constructor(private readonly mailJobs: MailJobs) {}

  onModuleInit(): void {
    setBetterAuthMailDispatcher(this.mailJobs);
  }
}
