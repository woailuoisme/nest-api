import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { MailTemplateRenderer } from './mail-template.renderer';
import { MAIL_TRANSPORTER, MailTransporterLifecycle, mailTransporterProvider } from './mail-transporter.provider';
import { MailService } from './mail.service';

/**
 * 全局邮件模块
 *
 * 自持装配（不再依赖 @nestjs-modules/mailer）：
 * 1. 传输层由 nodemailer 直接创建，SMTP 连接池由 nodemailer 自身管理（应用关闭时显式 close）；
 * 2. 模板渲染由 MailTemplateRenderer 以 Handlebars strict 模式完成，模板来自构建期拷贝的 templates 目录；
 * 3. 标记为 @Global()，业务模块与独立 Worker 进程无需重复 import 即可全局注入 MailService。
 *
 * 仅依赖 ConfigModule 与文件系统，因此可在无 HTTP 运行期的 Worker 进程中直接导入。
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [mailTransporterProvider, MailTransporterLifecycle, MailTemplateRenderer, MailService],
  // 仅导出消费方所需：MailService 供业务注入，MAIL_TRANSPORTER 供测试以 overrideProvider 替换传输层
  exports: [MailService, MAIL_TRANSPORTER],
})
export class MailModule {}
