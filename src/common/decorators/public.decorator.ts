import { Public as AuthenticationPublic } from '@nestjs/authentication';

/** 公开接口装饰器（项目统一入口，语义等价于官方 `@Public`） */
export const Public = AuthenticationPublic;
