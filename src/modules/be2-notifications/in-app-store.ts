import { randomUUID } from 'node:crypto';
import {
  acceptNotification,
  listNotifications,
  markNotificationRead,
  type Notification,
  type NotificationAcceptPolicy,
} from '../be2-consultations/notification.js';
import type { NotificationDestination } from './types.js';

const DEFAULT_POLICY: NotificationAcceptPolicy = {
  event: 'optional',
  subject: 'optional',
  event_repeat: 'allow',
};

export type InAppNotificationRecord = Notification & {
  category?: string;
  destination_type?: string;
  destination_resource_id?: string;
};

/**
 * Wraps existing pure notification functions. Does not call FCM.
 * Access must be verified by the caller (AuthorizationPort / session).
 */
export class InAppNotificationStore {
  private notifications: Notification[] = [];
  private readonly extras = new Map<string, {
    category?: string;
    destination_type?: string;
    destination_resource_id?: string;
  }>();

  create(input: {
    recipient_user_id: string;
    kind: string;
    title: string;
    body: string;
    event_id?: string;
    appointment_id?: string;
    follow_up_id?: string;
    person_id?: string;
    created_at: string;
    category?: string;
    destination?: NotificationDestination;
    notification_id?: string;
  }): { outcome: 'accepted' | 'duplicate' | 'conflict' | 'rejected'; notification?: InAppNotificationRecord; reason?: string } {
    const notificationId = input.notification_id ?? randomUUID();
    const result = acceptNotification(this.notifications, {
      notification_id: notificationId,
      recipient_user_id: input.recipient_user_id,
      kind: input.kind,
      title: input.title,
      body: input.body,
      ...(input.event_id ? { event_id: input.event_id } : {}),
      ...(input.appointment_id ? { appointment_id: input.appointment_id } : {}),
      ...(input.follow_up_id ? { follow_up_id: input.follow_up_id } : {}),
      ...(input.person_id ? { person_id: input.person_id } : {}),
      created_at: input.created_at,
    }, DEFAULT_POLICY, { verified: true, allowed: true });

    if (result.outcome === 'accepted') {
      this.notifications = result.notifications;
      this.extras.set(result.notification.notification_id.toLowerCase(), {
        category: input.category,
        destination_type: input.destination?.type,
        destination_resource_id: input.destination?.resource_id,
      });
      return { outcome: 'accepted', notification: this.enrich(result.notification) };
    }
    if (result.outcome === 'duplicate') {
      return { outcome: 'duplicate', notification: this.enrich(result.notification) };
    }
    if (result.outcome === 'conflict') {
      return { outcome: 'conflict', reason: result.reason };
    }
    return { outcome: 'rejected', reason: result.reason };
  }

  list(actorUserId: string, filters?: {
    unread_only?: boolean;
    kind?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }): { outcome: 'listed'; notifications: InAppNotificationRecord[]; unread_count: number } | { outcome: 'rejected'; reason: string } {
    const listed = listNotifications(this.notifications, actorUserId, { verified: true, allowed: true });
    if (listed.outcome !== 'listed') return listed;
    let rows = listed.notifications.map((row) => this.enrich(row));
    if (filters?.unread_only) rows = rows.filter((row) => row.read_at === undefined);
    if (filters?.kind) rows = rows.filter((row) => row.kind === filters.kind);
    if (filters?.category) rows = rows.filter((row) => row.category === filters.category);
    rows.sort((a, b) => {
      const left = a.created_at ?? '';
      const right = b.created_at ?? '';
      return right.localeCompare(left);
    });
    const unread_count = rows.filter((row) => row.read_at === undefined).length;
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 50;
    return {
      outcome: 'listed',
      notifications: rows.slice(offset, offset + limit),
      unread_count,
    };
  }

  unreadCount(actorUserId: string): number {
    const listed = this.list(actorUserId, { unread_only: true, limit: 10_000 });
    return listed.outcome === 'listed' ? listed.unread_count : 0;
  }

  markRead(actorUserId: string, notificationId: string, readAt: string) {
    const result = markNotificationRead(
      this.notifications,
      notificationId,
      readAt,
      actorUserId,
      { verified: true, allowed: true },
    );
    if (result.outcome === 'read' || result.outcome === 'already_read') {
      this.notifications = result.notifications;
      return { outcome: result.outcome, notification: this.enrich(result.notification) };
    }
    return result;
  }

  private enrich(notification: Notification): InAppNotificationRecord {
    const extra = this.extras.get(notification.notification_id.toLowerCase()) ?? {};
    return {
      ...notification,
      ...extra,
    };
  }
}
