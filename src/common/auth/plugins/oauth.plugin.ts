import { genericOAuth, oneTap } from 'better-auth/plugins';

const googleClientId = process.env.GOOGLE_CLIENT_ID || 'google-client-id';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || 'google-client-secret';

/**
 * 社交与开放授权插件集：Google OneTap 与 Generic OAuth 适配
 */
export const oauthPlugins = [
  oneTap({
    clientId: googleClientId,
    disableSignup: false,
  }),
  genericOAuth({
    config: [
      {
        providerId: 'google',
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      },
    ],
  }),
];
