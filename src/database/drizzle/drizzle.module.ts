import { Global, Module } from '@nestjs/common';
import { DRIZZLE_DB, DrizzleService } from './drizzle.service';

@Global()
@Module({
  providers: [
    DrizzleService,
    {
      provide: DRIZZLE_DB,
      useFactory: (drizzleService: DrizzleService) => drizzleService.db,
      inject: [DrizzleService],
    },
  ],
  exports: [DrizzleService, DRIZZLE_DB],
})
export class DatabaseModule {}
