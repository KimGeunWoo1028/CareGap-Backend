import { randomUUID } from 'node:crypto';
import type { OutboxStatus, PushChannel } from './types.js';

export type OutboxJob = {
  outbox_id: string;
  /** Unique per logical send intent (event + recipient + channel + schedule bucket). */
  idempotency_key: string;
  event_id: string;
  notification_id: string;
  recipient_user_id: string;
  channel: PushChannel;
  status: OutboxStatus;
  scheduled_at: string;
  attempt_count: number;
  next_attempt_at: string;
  last_error_code?: string;
  claim_owner?: string;
  claim_expires_at?: string;
  created_at: string;
  updated_at: string;
};

export type OutboxInsert = {
  idempotency_key: string;
  event_id: string;
  notification_id: string;
  recipient_user_id: string;
  channel: PushChannel;
  scheduled_at: string;
  created_at: string;
};

export interface NotificationOutboxRepository {
  enqueue(job: OutboxInsert, newId?: () => string): Promise<{ outcome: 'enqueued' | 'duplicate'; job: OutboxJob }>;
  /**
   * Claim due jobs with SKIP LOCKED semantics (memory: single-process mutex).
   * claim_owner must be unique per worker instance.
   */
  claimDue(nowIso: string, limit: number, claimOwner: string, claimTtlMs: number): Promise<OutboxJob[]>;
  markSent(outboxId: string, nowIso: string): Promise<void>;
  markRetry(outboxId: string, nowIso: string, nextAttemptAt: string, errorCode: string): Promise<void>;
  markPermanentFailure(outboxId: string, nowIso: string, errorCode: string): Promise<void>;
  cancelByEvent(eventId: string, nowIso: string): Promise<number>;
  cancelByNotification(notificationId: string, nowIso: string): Promise<number>;
  /** Cancel pending reminder jobs for an appointment resource id encoded in idempotency prefix. */
  cancelByIdempotencyPrefix(prefix: string, nowIso: string): Promise<number>;
  listByRecipient(recipientUserId: string): Promise<OutboxJob[]>;
}

function copyJob(job: OutboxJob): OutboxJob {
  return { ...job };
}

export function computeBackoffMs(attemptCount: number, baseMs = 1000, maxMs = 15 * 60 * 1000): number {
  const exp = Math.min(maxMs, baseMs * (2 ** Math.max(0, attemptCount - 1)));
  const jitter = Math.floor(Math.random() * Math.min(1000, exp * 0.2));
  return exp + jitter;
}

export class MemoryNotificationOutboxRepository implements NotificationOutboxRepository {
  private readonly jobs: OutboxJob[] = [];
  private readonly lock = { held: false };

  async enqueue(input: OutboxInsert, newId: () => string = randomUUID) {
    const existing = this.jobs.find((job) => job.idempotency_key === input.idempotency_key);
    if (existing) {
      // Reminder reschedule cancels prior rows then reuses the same key.
      if (existing.status === 'cancelled') {
        existing.event_id = input.event_id;
        existing.notification_id = input.notification_id;
        existing.recipient_user_id = input.recipient_user_id;
        existing.channel = input.channel;
        existing.status = 'pending';
        existing.scheduled_at = input.scheduled_at;
        existing.next_attempt_at = input.scheduled_at;
        existing.attempt_count = 0;
        existing.last_error_code = undefined;
        existing.claim_owner = undefined;
        existing.claim_expires_at = undefined;
        existing.updated_at = input.created_at;
        return { outcome: 'enqueued' as const, job: copyJob(existing) };
      }
      return { outcome: 'duplicate' as const, job: copyJob(existing) };
    }
    const job: OutboxJob = {
      outbox_id: newId(),
      idempotency_key: input.idempotency_key,
      event_id: input.event_id,
      notification_id: input.notification_id,
      recipient_user_id: input.recipient_user_id,
      channel: input.channel,
      status: 'pending',
      scheduled_at: input.scheduled_at,
      attempt_count: 0,
      next_attempt_at: input.scheduled_at,
      created_at: input.created_at,
      updated_at: input.created_at,
    };
    this.jobs.push(job);
    return { outcome: 'enqueued' as const, job: copyJob(job) };
  }

  async claimDue(nowIso: string, limit: number, claimOwner: string, claimTtlMs: number) {
    while (this.lock.held) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    this.lock.held = true;
    try {
      const now = Date.parse(nowIso);
      const claimed: OutboxJob[] = [];
      for (const job of this.jobs) {
        if (claimed.length >= limit) break;
        const expiredClaim = job.claim_expires_at !== undefined && Date.parse(job.claim_expires_at) <= now;
        const claimableStatus = job.status === 'pending'
          || job.status === 'failed_transient'
          || (job.status === 'claimed' && expiredClaim);
        if (!claimableStatus) continue;
        if (Date.parse(job.next_attempt_at) > now) continue;
        job.status = 'claimed';
        job.claim_owner = claimOwner;
        job.claim_expires_at = new Date(now + claimTtlMs).toISOString();
        job.updated_at = nowIso;
        claimed.push(copyJob(job));
      }
      return claimed;
    } finally {
      this.lock.held = false;
    }
  }

  async markSent(outboxId: string, nowIso: string) {
    const job = this.require(outboxId);
    job.status = 'sent';
    job.updated_at = nowIso;
    job.claim_owner = undefined;
    job.claim_expires_at = undefined;
  }

  async markRetry(outboxId: string, nowIso: string, nextAttemptAt: string, errorCode: string) {
    const job = this.require(outboxId);
    job.status = 'failed_transient';
    job.attempt_count += 1;
    job.next_attempt_at = nextAttemptAt;
    job.last_error_code = errorCode;
    job.updated_at = nowIso;
    job.claim_owner = undefined;
    job.claim_expires_at = undefined;
  }

  async markPermanentFailure(outboxId: string, nowIso: string, errorCode: string) {
    const job = this.require(outboxId);
    job.status = 'failed_permanent';
    job.attempt_count += 1;
    job.last_error_code = errorCode;
    job.updated_at = nowIso;
    job.claim_owner = undefined;
    job.claim_expires_at = undefined;
  }

  async cancelByEvent(eventId: string, nowIso: string) {
    return this.cancelWhere((job) => job.event_id.toLowerCase() === eventId.toLowerCase(), nowIso);
  }

  async cancelByNotification(notificationId: string, nowIso: string) {
    return this.cancelWhere((job) => job.notification_id.toLowerCase() === notificationId.toLowerCase(), nowIso);
  }

  async cancelByIdempotencyPrefix(prefix: string, nowIso: string) {
    return this.cancelWhere((job) => job.idempotency_key.startsWith(prefix), nowIso);
  }

  async listByRecipient(recipientUserId: string) {
    return this.jobs
      .filter((job) => job.recipient_user_id.toLowerCase() === recipientUserId.toLowerCase())
      .map(copyJob);
  }

  private cancelWhere(predicate: (job: OutboxJob) => boolean, nowIso: string): number {
    let count = 0;
    for (const job of this.jobs) {
      if (!predicate(job)) continue;
      if (job.status === 'sent' || job.status === 'cancelled' || job.status === 'failed_permanent') continue;
      job.status = 'cancelled';
      job.updated_at = nowIso;
      job.claim_owner = undefined;
      job.claim_expires_at = undefined;
      count += 1;
    }
    return count;
  }

  private require(outboxId: string): OutboxJob {
    const job = this.jobs.find((row) => row.outbox_id.toLowerCase() === outboxId.toLowerCase());
    if (!job) throw new Error('OUTBOX_NOT_FOUND');
    return job;
  }
}
