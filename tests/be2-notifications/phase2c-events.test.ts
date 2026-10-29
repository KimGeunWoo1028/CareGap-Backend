import { describe, expect, it } from 'vitest';
import { analysisEventToNotificationEvent } from '../../src/modules/be2-notifications/analysis-event-adapter.js';
import { fakeClock } from '../../src/modules/be2-notifications/clock.js';
import { InAppNotificationStore } from '../../src/modules/be2-notifications/in-app-store.js';
import { NotificationService } from '../../src/modules/be2-notifications/notification-service.js';
import { MemoryNotificationOutboxRepository } from '../../src/modules/be2-notifications/outbox.js';
import { MemoryNotificationPreferenceRepository } from '../../src/modules/be2-notifications/preferences.js';
import {
  NotificationRecipientResolver,
  type AdminRolePort,
  type FamilySharePort,
  type PersonUserLinkPort,
  type StaffAssignmentPort,
} from '../../src/modules/be2-notifications/recipient-resolver.js';
import { createDenyClosedResolver } from '../../src/modules/be2-notifications/recipient-resolver.js';
import { LOCK_SCREEN_DEFAULT_BODY } from '../../src/modules/be2-notifications/types.js';
import { buildSafePushPayload } from '../../src/modules/be2-notifications/payload.js';

const patientUser = '33333333-3333-4333-8333-333333333333';
const staffUser = '55555555-5555-4555-8555-555555555555';
const familyUser = '66666666-6666-4666-8666-666666666666';
const adminUser = '77777777-7777-4777-8777-777777777777';
const personId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const appointmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const personLink: PersonUserLinkPort = {
  async resolveUserForPerson(id) {
    if (id.toLowerCase() === personId) return { verified: true, user_id: patientUser };
    return { verified: false, reason: 'unlinked' };
  },
};
const staffPort: StaffAssignmentPort = {
  async isAssignedStaff(staffUserId, pid) {
    if (staffUserId === staffUser && pid === personId) return { verified: true, allowed: true };
    return { verified: true, allowed: false, reason: 'not_assigned' };
  },
};
const familyDeny: FamilySharePort = {
  async canReceiveFamilyNotification() {
    return { verified: false, reason: 'BE1_FAMILY_SHARE_POLICY_UNSET' };
  },
};
const familyAllow: FamilySharePort = {
  async canReceiveFamilyNotification(input) {
    if (input.familyUserId === familyUser && input.personId === personId) {
      return { verified: true, allowed: true };
    }
    return { verified: true, allowed: false };
  },
};
const adminPort: AdminRolePort = {
  async isApprovedAdmin(userId) {
    if (userId === adminUser) return { verified: true, allowed: true };
    return { verified: true, allowed: false };
  },
};

function service(family: FamilySharePort = familyDeny) {
  const store = new InAppNotificationStore();
  const outbox = new MemoryNotificationOutboxRepository();
  const preferences = new MemoryNotificationPreferenceRepository();
  const resolver = new NotificationRecipientResolver(personLink, staffPort, family, adminPort);
  const clock = fakeClock('2026-10-30T00:00:00.000Z');
  return {
    store,
    outbox,
    preferences,
    service: new NotificationService(store, outbox, preferences, resolver, clock),
  };
}

describe('Phase 2-C domain event handling', () => {
  it('blocks all delivery when resolver is deny-closed', async () => {
    const store = new InAppNotificationStore();
    const outbox = new MemoryNotificationOutboxRepository();
    const preferences = new MemoryNotificationPreferenceRepository();
    const clock = fakeClock('2026-10-30T00:00:00.000Z');
    const svc = new NotificationService(store, outbox, preferences, createDenyClosedResolver(), clock);
    const result = await svc.handleDomainEvent({
      event_id: eventId,
      event_type: 'APPOINTMENT_REQUESTED',
      occurred_at: '2026-10-30T00:00:00.000Z',
      person_id: personId,
      resource_type: 'APPOINTMENT',
      resource_id: appointmentId,
      event_version: 1,
      metadata: { starts_at: '2026-10-31T10:00:00.000Z' },
    }, { staff_user_id: staffUser, family_user_ids: [familyUser] });
    expect(result.blocked_reason).toBe('no_verified_recipients');
    expect(result.created_notifications).toBe(0);
  });

  it('creates patient+staff in-app rows and outbox for appointment request', async () => {
    const ctx = service();
    const result = await ctx.service.handleDomainEvent({
      event_id: eventId,
      event_type: 'APPOINTMENT_REQUESTED',
      occurred_at: '2026-10-30T00:00:00.000Z',
      person_id: personId,
      resource_type: 'APPOINTMENT',
      resource_id: appointmentId,
      event_version: 1,
      metadata: {},
    }, { staff_user_id: staffUser, family_user_ids: [familyUser] });

    expect(result.created_notifications).toBe(2);
    expect(result.enqueued_outbox).toBe(2);
    const patientList = ctx.store.list(patientUser);
    expect(patientList.outcome).toBe('listed');
    if (patientList.outcome === 'listed') {
      expect(patientList.notifications[0]?.destination_type).toBe('APPOINTMENT');
      expect(patientList.notifications[0]?.body).not.toMatch(/원문|복약|주민/);
    }
  });

  it('denies family recipients when share policy is unset', async () => {
    const ctx = service(familyDeny);
    await ctx.service.handleDomainEvent({
      event_id: eventId,
      event_type: 'APPOINTMENT_ACCEPTED',
      occurred_at: '2026-10-30T00:00:00.000Z',
      person_id: personId,
      resource_type: 'APPOINTMENT',
      resource_id: appointmentId,
      event_version: 1,
      metadata: {},
    }, { family_user_ids: [familyUser] });
    const familyList = ctx.store.list(familyUser);
    expect(familyList.outcome).toBe('listed');
    if (familyList.outcome === 'listed') expect(familyList.notifications).toHaveLength(0);
  });

  it('allows family only when share port explicitly allows', async () => {
    const ctx = service(familyAllow);
    const result = await ctx.service.handleDomainEvent({
      event_id: eventId,
      event_type: 'APPOINTMENT_ACCEPTED',
      occurred_at: '2026-10-30T00:00:00.000Z',
      person_id: personId,
      resource_type: 'APPOINTMENT',
      resource_id: appointmentId,
      event_version: 1,
      metadata: {},
    }, { family_user_ids: [familyUser] });
    expect(result.created_notifications).toBe(2); // patient + family
    const familyList = ctx.store.list(familyUser);
    expect(familyList.outcome).toBe('listed');
    if (familyList.outcome === 'listed') expect(familyList.notifications).toHaveLength(1);
  });

  it('is idempotent on event replay', async () => {
    const ctx = service();
    const event = {
      event_id: eventId,
      event_type: 'APPOINTMENT_CANCELLED' as const,
      occurred_at: '2026-10-30T00:00:00.000Z',
      person_id: personId,
      resource_type: 'APPOINTMENT' as const,
      resource_id: appointmentId,
      event_version: 1,
      metadata: {},
    };
    const first = await ctx.service.handleDomainEvent(event, { staff_user_id: staffUser });
    const second = await ctx.service.handleDomainEvent(event, { staff_user_id: staffUser });
    expect(first.created_notifications).toBe(2);
    expect(second.created_notifications).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(second.enqueued_outbox).toBe(0);
  });

  it('stores admin welfare review request as in-app only (no external push)', async () => {
    const ctx = service();
    const result = await ctx.service.handleDomainEvent({
      event_id: eventId,
      event_type: 'WELFARE_REVIEW_REQUESTED',
      occurred_at: '2026-10-30T00:00:00.000Z',
      resource_type: 'WELFARE_REVIEW',
      resource_id: appointmentId,
      event_version: 1,
      metadata: {},
    }, { admin_user_ids: [adminUser] });
    expect(result.created_notifications).toBe(1);
    expect(result.enqueued_outbox).toBe(0);
  });

  it('adapts analysis.succeeded without copying record text into push payload', () => {
    const adapted = analysisEventToNotificationEvent({
      type: 'analysis.succeeded',
      event_id: eventId,
      occurred_at: '2026-10-30T00:00:00.000Z',
      analysis_id: 'abababab-abab-4aba-8aba-abababababab',
      consultation_id: 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd',
      record_version_id: 'efefefef-efef-4efe-8efe-efefefefefef',
      person_id: personId,
    });
    expect(adapted.event_type).toBe('ANALYSIS_COMPLETED');
    const payload = buildSafePushPayload({
      notification_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      event: adapted,
      category: 'analysis',
      destination: { type: 'ANALYSIS', resource_id: adapted.resource_id },
    });
    expect(payload.body).toBe(LOCK_SCREEN_DEFAULT_BODY);
    expect(JSON.stringify(payload)).not.toContain('consultation_id');
  });

  it('respects push_enabled preference while still storing in-app when allowed', async () => {
    const ctx = service();
    await ctx.preferences.update(patientUser, patientUser, { push_enabled: false }, '2026-10-30T00:00:00.000Z');
    const result = await ctx.service.handleDomainEvent({
      event_id: eventId,
      event_type: 'MESSAGE_RECEIVED',
      occurred_at: '2026-10-30T00:00:00.000Z',
      person_id: personId,
      resource_type: 'MESSAGE',
      resource_id: appointmentId,
      event_version: 1,
      metadata: {},
    }, { message_recipient_user_id: patientUser });
    // patient via person link + message peer dedupe => 1
    expect(result.created_notifications).toBeGreaterThanOrEqual(1);
    expect(result.enqueued_outbox).toBe(0);
  });

  it('does not treat staff role alone as assignment', async () => {
    const ctx = service();
    const randomStaff = '88888888-8888-4888-8888-888888888888';
    const result = await ctx.service.handleDomainEvent({
      event_id: eventId,
      event_type: 'ANALYSIS_COMPLETED',
      occurred_at: '2026-10-30T00:00:00.000Z',
      person_id: personId,
      resource_type: 'ANALYSIS',
      resource_id: appointmentId,
      event_version: 1,
      metadata: {},
    }, { staff_user_id: randomStaff });
    const staffList = ctx.store.list(randomStaff);
    expect(staffList.outcome).toBe('listed');
    if (staffList.outcome === 'listed') expect(staffList.notifications).toHaveLength(0);
    expect(result.created_notifications).toBe(1); // patient only
  });
});
