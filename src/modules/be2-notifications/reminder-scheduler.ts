import type { Clock } from './clock.js';
import { utcIso } from './clock.js';
import type { NotificationOutboxRepository } from './outbox.js';

/**
 * Reminder offsets are PROVISIONAL policy candidates (1 day / 1 hour).
 * When unset, no reminder jobs are created for production paths.
 */
export type ReminderPolicy =
  | { status: 'unset'; reason: 'PROVISIONAL_REMINDER_POLICY_UNSET' }
  | { status: 'configured'; offsets_ms: number[] };

export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  status: 'unset',
  reason: 'PROVISIONAL_REMINDER_POLICY_UNSET',
};

/** Candidate values only — do not activate in production without team confirmation. */
export const CANDIDATE_REMINDER_OFFSETS_MS = {
  one_day: 24 * 60 * 60 * 1000,
  one_hour: 60 * 60 * 1000,
} as const;

export type ReminderPlan = {
  appointment_id: string;
  starts_at: string;
  recipient_user_id: string;
  notification_id: string;
  event_id: string;
};

export class ReminderScheduler {
  constructor(
    private readonly outbox: NotificationOutboxRepository,
    private readonly clock: Clock,
    private readonly policy: ReminderPolicy = DEFAULT_REMINDER_POLICY,
  ) {}

  async reschedule(plan: ReminderPlan): Promise<{
    outcome: 'scheduled' | 'policy_unset' | 'all_past';
    enqueued: number;
    cancelled: number;
  }> {
    const prefix = `reminder:${plan.appointment_id}:`;
    const cancelled = await this.outbox.cancelByIdempotencyPrefix(prefix, utcIso(this.clock.now()));
    if (this.policy.status !== 'configured') {
      return { outcome: 'policy_unset', enqueued: 0, cancelled };
    }

    const startsAtMs = Date.parse(plan.starts_at);
    if (!Number.isFinite(startsAtMs)) throw new Error('INVALID_STARTS_AT');
    const nowMs = this.clock.now().getTime();
    let enqueued = 0;

    for (const offset of this.policy.offsets_ms) {
      const fireAt = startsAtMs - offset;
      if (fireAt <= nowMs) continue;
      const scheduledAt = new Date(fireAt).toISOString();
      const key = `${prefix}${offset}:${plan.recipient_user_id}`;
      const result = await this.outbox.enqueue({
        idempotency_key: key,
        event_id: plan.event_id,
        notification_id: plan.notification_id,
        recipient_user_id: plan.recipient_user_id,
        channel: 'fcm',
        scheduled_at: scheduledAt,
        created_at: utcIso(this.clock.now()),
      });
      if (result.outcome === 'enqueued') enqueued += 1;
    }

    return {
      outcome: enqueued > 0 ? 'scheduled' : 'all_past',
      enqueued,
      cancelled,
    };
  }

  async cancelAppointment(appointmentId: string): Promise<number> {
    return this.outbox.cancelByIdempotencyPrefix(
      `reminder:${appointmentId}:`,
      utcIso(this.clock.now()),
    );
  }
}
