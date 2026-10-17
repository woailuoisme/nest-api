import { organization } from 'better-auth/plugins';

import { authMailHandlers } from '../mail-dispatcher';

/**
 * 多租户组织与团队插件
 */
export const organizationPlugin = organization({
  sendInvitationEmail: async ({ email, invitation, organization: org }) => {
    await authMailHandlers.sendInvitationEmail({ email, invitation, organization: org });
  },
});
