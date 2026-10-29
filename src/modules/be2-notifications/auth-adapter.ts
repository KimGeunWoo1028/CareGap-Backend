import type { Actor } from '../../shared/contracts.js';

/**
 * Notification HTTP auth port. Does not invent a new auth system.
 * Until BE1 JWT/session contracts are wired for notification routes, deny.
 */
export type NotificationAuthResult =
  | { authenticated: false; reason: string }
  | { authenticated: true; actor: Actor };

export interface NotificationAuthPort {
  authenticate(authorizationHeader: string | undefined): Promise<NotificationAuthResult>;
}

export const unsetNotificationAuth: NotificationAuthPort = {
  async authenticate() {
    return { authenticated: false, reason: 'BE1_NOTIFICATION_AUTH_UNSET' };
  },
};

/** Test helper only — never mount in production app wiring. */
export function fixedActorAuth(actor: Actor): NotificationAuthPort {
  return {
    async authenticate(header) {
      if (!header?.startsWith('Bearer ')) {
        return { authenticated: false, reason: 'missing_bearer' };
      }
      return { authenticated: true, actor };
    },
  };
}
