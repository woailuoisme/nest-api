export { MailModule } from './mail.module';
export { HandlebarsTemplateEngine } from './handlebars-template.engine';
export { createMailTransport } from './mail-transport.factory';
export {
  MAIL_SUBJECTS,
  type MailLocale,
  type MailPayload,
  type MailRecipient,
  type MailTemplateName,
  subjectFor,
} from './mail.types';
export { EmailOtpMail, type EmailOtpData } from './mails/email-otp.mail';
export { PasswordResetMail, type PasswordResetData } from './mails/password-reset.mail';
export { VerifyEmailMail, type VerifyEmailData } from './mails/verify-email.mail';
export { WelcomeMail, type WelcomeData } from './mails/welcome.mail';
