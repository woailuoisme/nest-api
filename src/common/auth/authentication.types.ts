import type { SessionRecord } from '@nestjs/authentication';

import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: CurrentUserPayload;
    session: SessionRecord;
    sessionExtra: { user: CurrentUserPayload };
  }
}
