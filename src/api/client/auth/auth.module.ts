import { Module, type OnModuleInit } from '@nestjs/common';
import { setBetterAuthMailDispatcher } from '@/common/auth/better-auth';
import { BetterAuthGuard } from '@/common/guards/better-auth.guard';
import { MailJobs } from '@/queues/mail/mail.jobs';
import { QueuesModule } from '@/queues/queues.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [QueuesModule],
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
