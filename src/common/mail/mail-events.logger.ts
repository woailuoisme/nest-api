import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { MailEvents } from '@nestjs/mail';

/** 将官方 MailEvents 汇入 Pino 日志（发送成功/失败、重试与永久失败） */
@Injectable()
export class MailEventsLogger implements OnModuleInit {
  private readonly logger = new Logger(MailEventsLogger.name);

  constructor(private readonly events: MailEvents) {}

  onModuleInit(): void {
    this.events.events$.subscribe((event) => {
      if (event.type === 'sent') {
        this.logger.log(`Mail sent (messageId=${event.messageId})`);
        return;
      }
      this.logger.warn(`Mail failed (permanent=${event.permanent}): ${(event.error as Error)?.message ?? 'unknown'}`);
    });
  }
}
