import { randomUUID } from 'node:crypto';
import type { Clock } from './clock.js';
import { utcIso } from './clock.js';
import type { DeviceRegistrationRepository } from './devices.js';
import type { InAppNotificationStore } from './in-app-store.js';
import { computeBackoffMs, type NotificationOutboxRepository, type OutboxJob } from './outbox.js';
import { buildSafePushPayload } from './payload.js';
import type { NotificationPreferenceRepository } from './preferences.js';
import type { PushProvider } from './push-provider.js';
import { DomainNotificationEvent, type NotificationCategory, type NotificationDestination } from './types.js';

export type WorkerOptions = {
  maxAttempts?: number;
  batchSize?: number;
  claimTtlMs?: number;
  workerId?: string;
};

/**
 * Polls outbox, loads devices, sends via PushProvider outside any DB transaction.
 * At-least-once external delivery; internal intent is idempotent via outbox keys.
 */
export class NotificationWorker {
  private readonly maxAttempts: number;
  private readonly batchSize: number;
  private readonly claimTtlMs: number;
  private readonly workerId: string;

  constructor(
    private readonly outbox: NotificationOutboxRepository,
    private readonly devices: DeviceRegistrationRepository,
    private readonly preferences: NotificationPreferenceRepository,
    private readonly store: InAppNotificationStore,
    private readonly push: PushProvider,
    private readonly clock: Clock,
    options: WorkerOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 8;
    this.batchSize = options.batchSize ?? 20;
    this.claimTtlMs = options.claimTtlMs ?? 30_000;
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
  }

  async tick(): Promise<{ claimed: number; sent: number; retried: number; failed: number }> {
    const nowIso = utcIso(this.clock.now());
    const jobs = await this.outbox.claimDue(nowIso, this.batchSize, this.workerId, this.claimTtlMs);
    let sent = 0;
    let retried = 0;
    let failed = 0;

    for (const job of jobs) {
      const result = await this.processJob(job, nowIso);
      if (result === 'sent') sent += 1;
      else if (result === 'retried') retried += 1;
      else failed += 1;
    }

    return { claimed: jobs.length, sent, retried, failed };
  }

  private async processJob(job: OutboxJob, nowIso: string): Promise<'sent' | 'retried' | 'failed'> {
    if (job.channel !== 'fcm') {
      await this.outbox.markPermanentFailure(job.outbox_id, nowIso, 'UNSUPPORTED_CHANNEL');
      return 'failed';
    }

    const devices = await this.devices.listActiveByUser(job.recipient_user_id);
    if (devices.length === 0) {
      await this.outbox.markPermanentFailure(job.outbox_id, nowIso, 'NO_ACTIVE_DEVICES');
      return 'failed';
    }

    const prefs = await this.preferences.get(job.recipient_user_id);
    const listed = this.store.list(job.recipient_user_id, { limit: 500 });
    const notification = listed.outcome === 'listed'
      ? listed.notifications.find((row) =>
        row.notification_id.toLowerCase() === job.notification_id.toLowerCase())
      : undefined;

    if (!notification) {
      await this.outbox.markPermanentFailure(job.outbox_id, nowIso, 'NOTIFICATION_MISSING');
      return 'failed';
    }

    const category = (notification.category ?? 'system') as NotificationCategory;
    const destination: NotificationDestination = {
      type: (notification.destination_type as NotificationDestination['type']) ?? 'NONE',
      ...(notification.destination_resource_id
        ? { resource_id: notification.destination_resource_id }
        : {}),
    };

    const event = DomainNotificationEvent.parse({
      event_id: job.event_id,
      event_type: notification.kind,
      occurred_at: notification.created_at ?? nowIso,
      person_id: notification.person_id,
      resource_type: destination.type,
      resource_id: destination.resource_id,
      event_version: 1,
      metadata: {},
    });

    const payload = buildSafePushPayload({
      notification_id: notification.notification_id,
      event,
      category,
      destination,
      preferenceAllowsRichLockScreen: prefs.lock_screen_rich_preview,
    });

    const response = await this.push.send({
      targets: devices.map((device) => ({
        device_registration_id: device.device_registration_id,
        platform: device.platform,
        registration_token: device.registration_token,
      })),
      payload,
    });

    let anySuccess = false;
    let retryableFailure = false;
    let lastError = 'UNKNOWN';

    for (const item of response.results) {
      if (item.result.outcome === 'success') {
        anySuccess = true;
        continue;
      }
      lastError = item.result.error_code;
      if (item.result.deactivate_device) {
        const device = devices.find((row) => row.device_registration_id === item.device_registration_id);
        if (device) await this.devices.deactivateByToken(device.registration_token, nowIso);
      }
      if (item.result.retryable) retryableFailure = true;
    }

    if (anySuccess && !retryableFailure) {
      await this.outbox.markSent(job.outbox_id, nowIso);
      return 'sent';
    }
    if (anySuccess && retryableFailure) {
      // Partial success: mark sent for internal intent; remaining devices may need a follow-up job later.
      await this.outbox.markSent(job.outbox_id, nowIso);
      return 'sent';
    }

    const attempts = job.attempt_count + 1;
    if (!retryableFailure || attempts >= this.maxAttempts) {
      await this.outbox.markPermanentFailure(job.outbox_id, nowIso, lastError);
      return 'failed';
    }

    const next = new Date(this.clock.now().getTime() + computeBackoffMs(attempts)).toISOString();
    await this.outbox.markRetry(job.outbox_id, nowIso, next, lastError);
    return 'retried';
  }
}
