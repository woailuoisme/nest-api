/** OAuth 统一用户资料接口，供 Google OAuth 策略及 AuthService 共享使用 */
export interface OAuthProfile {
  provider: 'google';
  providerUserId: string;
  email: string;
  name: string;
}
