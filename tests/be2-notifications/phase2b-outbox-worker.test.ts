import { describe, expect, it } from 'vitest';
import { fakeClock } from '../../src/modules/be2-notifications/clock.js';
import { MemoryDeviceRegistrationRepository } from '../../src/modules/be2-notifications/devices.js';
import { InAppNotificationStore } from '../../src/modules/be2-notifications/in-app-store.js';
import { MockPushProvider } from '../../src/modules/be2-notifications/mock-push-provider.js';
import {
  MemoryNotificationOutboxRepository,
  computeBackoffMs,
} from '../../src/modules/be2-notifications/outbox.js';
import { MemoryNotificationPreferenceRepository } from '../../src/modules/be2-notifications/preferences.js';
import {
  CANDIDATE_REMINDER_OFFSETS_MS,
  ReminderScheduler,
} from '../../src/modules/be2-notifications/reminder-scheduler.js';
import { NotificationWorker } from '../../src/modules/be2-notifications/worker.js';

const userId = '33333333-3333-4333-8333-333333333333';
const otherUser = '44444444-4444-4444-8444-444444444444';
const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const notificationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const appointmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('Phase 2-B device registry', () => {
  it('registers, rotates token, and rejects cross-user delete', async () => {
    const devices = new MemoryDeviceRegistrationRepository();
    const now = '2026-10-30T00:00:00.000Z';
    const first = await devices.upsert(userId, {
      platform: 'android',
      installation_id: 'install-device-001',
      registration_token: 'token-original-abcdefghijklmnopqrst',
    }, now, () => '11111111-1111-4111-8111-111111111111');
    expect(first.active).toBe(true);

    const rotated = await devices.upsert(userId, {
      platform: 'android',
      installation_id: 'install-device-001',
      registration_token: 'token-rotated-abcdefghijklmnopqrstu',
    }, '2026-10-30T01:00:00.000Z', () => '22222222-2222-4222-8222-222222222222');
    expect(rotated.device_registration_id).toBe(first.device_registration_id);
    expect(rotated.registration_token).toContain('rotated');

    const denied = await devices.deactivate(otherUser, first.device_registration_id, now);
    expect(denied).toMatchObject({ outcome: 'rejected', reason: 'owner_mismatch' });

    const logout = await devices.deactivateAllForUser(userId, now);
    expect(logout).toBe(1);
    expect(await devices.listActiveByUser(userId)).toHaveLength(0);
  });
});

describe('Phase 2-B outbox idempotency and worker', () => {
  it('dedupes enqueue by idempotency key', async () => {
    const outbox = new MemoryNotificationOutboxRepository();
    const first = await outbox.enqueue({
      idempotency_key: 'push:evt:user',
      event_id: eventId,
      notification_id: notificationId,
      recipient_user_id: userId,
      channel: 'fcm',
      scheduled_at: '2026-10-30T00:00:00.000Z',
      created_at: '2026-10-30T00:00:00.000Z',
    });
    const second = await outbox.enqueue({
      idempotency_key: 'push:evt:user',
      event_id: eventId,
      notification_id: notificationId,
      recipient_user_id: userId,
      channel: 'fcm',
      scheduled_at: '2026-10-30T00:00:00.000Z',
      created_at: '2026-10-30T00:00:00.000Z',
    });
    expect(first.outcome).toBe('enqueued');
    expect(second.outcome).toBe('duplicate');
    expect(second.job.outbox_id).toBe(first.job.outbox_id);
  });

  it('claims due jobs once across concurrent workers', async () => {
    const outbox = new MemoryNotificationOutboxRepository();
    await outbox.enqueue({
      idempotency_key: 'push:1',
      event_id: eventId,
      notification_id: notificationId,
      recipient_user_id: userId,
      channel: 'fcm',
      scheduled_at: '2026-10-30T00:00:00.000Z',
      created_at: '2026-10-30T00:00:00.000Z',
    });
    const [a, b] = await Promise.all([
      outbox.claimDue('2026-10-30T00:00:01.000Z', 10, 'worker-a', 30_000),
      outbox.claimDue('2026-10-30T00:00:01.000Z', 10, 'worker-b', 30_000),
    ]);
    expect(a.length + b.length).toBe(1);
  });

  it('retries transient failures with backoff and recovers after claim expiry', async () => {
    expect(computeBackoffMs(1, 1000, 10_000)).toBeGreaterThanOrEqual(1000);

    const clock = fakeClock('2026-10-30T00:00:00.000Z');
    const outbox = new MemoryNotificationOutboxRepository();
    const devices = new MemoryDeviceRegistrationRepository();
    const preferences = new MemoryNotificationPreferenceRepository();
    const store = new InAppNotificationStore();
    const push = new MockPushProvider();

    store.create({
      notification_id: notificationId,
      recipient_user_id: userId,
      kind: 'APPOINTMENT_ACCEPTED',
      title: '예약 수락',
      body: '상담 예약이 수락되었습니다.',
      event_id: eventId,
      created_at: '2026-10-30T00:00:00.000Z',
      category: 'appointment',
      destination: { type: 'APPOINTMENT', resource_id: appointmentId },
    });
    await devices.upsert(userId, {
      platform: 'ios',
      installation_id: 'install-ios-1',
      registration_token: 'ios-token-abcdefghijklmnopqrstuvwxyz',
    }, '2026-10-30T00:00:00.000Z', () => '11111111-1111-4111-8111-111111111111');

    await outbox.enqueue({
      idempotency_key: 'push:retry',
      event_id: eventId,
      notification_id: notificationId,
      recipient_user_id: userId,
      channel: 'fcm',
      scheduled_at: '2026-10-30T00:00:00.000Z',
      created_at: '2026-10-30T00:00:00.000Z',
    });

    push.behavior = {
      mode: 'fail_all',
      result: {
        outcome: 'failure',
        error_class: 'transient',
        error_code: 'messaging/server-unavailable',
        retryable: true,
      },
    };

    const worker = new NotificationWorker(outbox, devices, preferences, store, push, clock, {
      workerId: 'w1',
      maxAttempts: 3,
      claimTtlMs: 1,
    });
    const first = await worker.tick();
    expect(first.retried).toBe(1);

    clock.set('2026-10-30T00:05:00.000Z');
    push.behavior = { mode: 'success' };
    const second = await worker.tick();
    expect(second.sent).toBe(1);
  });

  it('deactivates unregistered devices on permanent token errors', async () => {
    const clock = fakeClock('2026-10-30T00:00:00.000Z');
    const outbox = new MemoryNotificationOutboxRepository();
    const devices = new MemoryDeviceRegistrationRepository();
    const preferences = new MemoryNotificationPreferenceRepository();
    const store = new InAppNotificationStore();
    const push = new MockPushProvider();

    store.create({
      notification_id: notificationId,
      recipient_user_id: userId,
      kind: 'MESSAGE_RECEIVED',
      title: '새 메시지',
      body: '새로운 메시지가 도착했습니다.',
      event_id: eventId,
      created_at: '2026-10-30T00:00:00.000Z',
      category: 'message',
      destination: { type: 'MESSAGE', resource_id: appointmentId },
    });
    await devices.upsert(userId, {
      platform: 'android',
      installation_id: 'install-android-1',
      registration_token: 'android-token-abcdefghijklmnopqrstuvw',
    }, '2026-10-30T00:00:00.000Z', () => '11111111-1111-4111-8111-111111111111');
    await outbox.enqueue({
      idempotency_key: 'push:dead-token',
      event_id: eventId,
      notification_id: notificationId,
      recipient_user_id: userId,
      channel: 'fcm',
      scheduled_at: '2026-10-30T00:00:00.000Z',
      created_at: '2026-10-30T00:00:00.000Z',
    });
    push.behavior = {
      mode: 'fail_all',
      result: {
        outcome: 'failure',
        error_class: 'unregistered',
        error_code: 'messaging/registration-token-not-registered',
        retryable: false,
        deactivate_device: true,
      },
    };
    const worker = new NotificationWorker(outbox, devices, preferences, store, push, clock);
    const result = await worker.tick();
    expect(result.failed).toBe(1);
    expect(await devices.listActiveByUser(userId)).toHaveLength(0);
  });
});

describe('Phase 2-B reminder scheduler', () => {
  it('does not schedule when policy is unset', async () => {
    const clock = fakeClock('2026-10-29T00:00:00.000Z');
    const outbox = new MemoryNotificationOutboxRepository();
    const scheduler = new ReminderScheduler(outbox, clock);
    const result = await scheduler.reschedule({
      appointment_id: appointmentId,
      starts_at: '2026-10-31T10:00:00.000Z',
      recipient_user_id: userId,
      notification_id: notificationId,
      event_id: eventId,
    });
    expect(result.outcome).toBe('policy_unset');
    expect(result.enqueued).toBe(0);
  });

  it('cancels past offsets and reschedules on time change with fake clock', async () => {
    const clock = fakeClock('2026-10-30T08:00:00.000Z');
    const outbox = new MemoryNotificationOutboxRepository();
    const scheduler = new ReminderScheduler(outbox, clock, {
      status: 'configured',
      offsets_ms: [CANDIDATE_REMINDER_OFFSETS_MS.one_day, CANDIDATE_REMINDER_OFFSETS_MS.one_hour],
    });

    const first = await scheduler.reschedule({
      appointment_id: appointmentId,
      starts_at: '2026-10-30T10:00:00.000Z',
      recipient_user_id: userId,
      notification_id: notificationId,
      event_id: eventId,
    });
    // 1 day before is past; 1 hour before (09:00) is future.
    expect(first.enqueued).toBe(1);

    const changed = await scheduler.reschedule({
      appointment_id: appointmentId,
      starts_at: '2026-10-30T12:00:00.000Z',
      recipient_user_id: userId,
      notification_id: notificationId,
      event_id: eventId,
    });
    expect(changed.cancelled).toBe(1);
    expect(changed.enqueued).toBe(1);

    const cancelled = await scheduler.cancelAppointment(appointmentId);
    expect(cancelled).toBe(1);
  });
});
