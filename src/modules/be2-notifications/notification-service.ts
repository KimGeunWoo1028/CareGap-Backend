import { createHash } from 'node:crypto';
import type { Clock } from './clock.js';
import { utcIso } from './clock.js';
import { planForEvent } from './event-mapping.js';
import { buildInAppCopy, buildSafePushPayload } from './payload.js';
import type { NotificationPreferenceRepository } from './preferences.js';
import { allowsInApp, allowsPushForCategory, DEFAULT_MANDATORY_POLICY } from './preferences.js';
import type {
  NotificationRecipientResolver,
  RecipientResolverContext,
} from './recipient-resolver.js';
import type { NotificationOutboxRepository } from './outbox.js';
import type { InAppNotificationStore } from './in-app-store.js';
import type { ReminderScheduler } from './reminder-scheduler.js';
import { DomainNotificationEvent, type DomainNotificationEvent as DomainEvent } from './types.js';

export type HandleEventResult = {
  event_id: string;
  created_notifications: number;
  enqueued_outbox: number;
  skipped_recipients: number;
  blocked_reason?: string;
  duplicates: number;
};

/**
 * Orchestrates Domain Event → resolve → policy → in-app persist → outbox.
 * Never calls FCM inside this class / DB transaction boundary.
 */
export class NotificationService {
  constructor(
    private readonly store: InAppNotificationStore,
    private readonly outbox: NotificationOutboxRepository,
    private readonly preferences: NotificationPreferenceRepository,
    private readonly resolver: NotificationRecipientResolver,
    private readonly clock: Clock,
    private readonly reminders?: ReminderScheduler,
  ) {}

  async handleDomainEvent(
    rawEvent: unknown,
    context: RecipientResolverContext = {},
  ): Promise<HandleEventResult> {
    const event = DomainNotificationEvent.parse(rawEvent);
    const plan = planForEvent(event);
    const resolved = await this.resolver.resolve(event, plan.category, context);

    if (resolved.outcome === 'blocked') {
      return {
        event_id: event.event_id,
        created_notifications: 0,
        enqueued_outbox: 0,
        skipped_recipients: 0,
        blocked_reason: resolved.reason,
        duplicates: 0,
      };
    }

    let created = 0;
    let enqueued = 0;
    let skipped = 0;
    let duplicates = 0;
    const now = utcIso(this.clock.now());
    const copy = buildInAppCopy(event.event_type);

    for (const recipient of resolved.recipients) {
      const prefs = await this.preferences.get(recipient.user_id);
      if (!allowsInApp(prefs, plan.category)) {
        skipped += 1;
        continue;
      }

      const idempotencyBase = `${event.event_id}:${recipient.user_id}:${plan.category}:v${event.event_version}`;
      const createdRow = this.store.create({
        notification_id: deterministicUuid(idempotencyBase),
        recipient_user_id: recipient.user_id,
        kind: event.event_type,
        title: copy.title,
        body: copy.body,
        event_id: event.event_id,
        person_id: event.person_id,
        appointment_id: plan.destination.type === 'APPOINTMENT' ? plan.destination.resource_id : undefined,
        created_at: now,
        category: plan.category,
        destination: plan.destination,
      });

      if (createdRow.outcome === 'duplicate') {
        duplicates += 1;
      } else if (createdRow.outcome === 'accepted' && createdRow.notification) {
        created += 1;
      } else {
        skipped += 1;
        continue;
      }

      const notification = createdRow.notification;
      if (!notification) continue;

      // Validate push payload even when push is off (guards sensitive content early).
      buildSafePushPayload({
        notification_id: notification.notification_id,
        event,
        category: plan.category,
        destination: plan.destination,
        preferenceAllowsRichLockScreen: prefs.lock_screen_rich_preview,
      });

      if (!plan.enqueue_push) continue;
      if (!allowsPushForCategory(prefs, plan.category, DEFAULT_MANDATORY_POLICY)) continue;

      const out = await this.outbox.enqueue({
        idempotency_key: `push:${idempotencyBase}`,
        event_id: event.event_id,
        notification_id: notification.notification_id,
        recipient_user_id: recipient.user_id,
        channel: 'fcm',
        scheduled_at: now,
        created_at: now,
      });
      if (out.outcome === 'enqueued') enqueued += 1;
    }

    if (
      this.reminders
      && event.event_type === 'APPOINTMENT_REQUESTED'
      && event.resource_id
      && typeof event.metadata.starts_at === 'string'
    ) {
      for (const recipient of resolved.recipients) {
        await this.reminders.reschedule({
          appointment_id: event.resource_id,
          starts_at: event.metadata.starts_at,
          recipient_user_id: recipient.user_id,
          notification_id: deterministicUuid(`${event.event_id}:${recipient.user_id}:reminder`),
          event_id: event.event_id,
        });
      }
    }

    if (this.reminders && event.event_type === 'APPOINTMENT_CANCELLED' && event.resource_id) {
      await this.reminders.cancelAppointment(event.resource_id);
    }

    if (
      this.reminders
      && event.event_type === 'APPOINTMENT_RESCHEDULED'
      && event.resource_id
      && typeof event.metadata.starts_at === 'string'
    ) {
      for (const recipient of resolved.recipients) {
        await this.reminders.reschedule({
          appointment_id: event.resource_id,
          starts_at: event.metadata.starts_at,
          recipient_user_id: recipient.user_id,
          notification_id: deterministicUuid(`${event.event_id}:${recipient.user_id}:reminder`),
          event_id: event.event_id,
        });
      }
    }

    return {
      event_id: event.event_id,
      created_notifications: created,
      enqueued_outbox: enqueued,
      skipped_recipients: skipped,
      duplicates,
    };
  }
}

/** Stable UUID v4-shaped id from a string for idempotent notification_id. */
export function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export type { DomainEvent };
