import { describe, expect, it } from 'vitest';
import { resolveFirebaseConfig } from '../../src/modules/be2-notifications/firebase-config.js';
import { FcmPushProvider } from '../../src/modules/be2-notifications/fcm-push-provider.js';
import { MockPushProvider } from '../../src/modules/be2-notifications/mock-push-provider.js';
import { buildSafePushPayload } from '../../src/modules/be2-notifications/payload.js';
import { classifyFcmErrorCode } from '../../src/modules/be2-notifications/push-errors.js';
import { LOCK_SCREEN_DEFAULT_BODY, LOCK_SCREEN_DEFAULT_TITLE } from '../../src/modules/be2-notifications/types.js';

const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const notificationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const resourceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function sampleEvent() {
  return {
    event_id: eventId,
    event_type: 'APPOINTMENT_ACCEPTED' as const,
    occurred_at: '2026-10-30T00:00:00.000Z',
    person_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    resource_type: 'APPOINTMENT' as const,
    resource_id: resourceId,
    event_version: 1,
    metadata: {},
  };
}

describe('Phase 2-A firebase config', () => {
  it('disables FCM by default', () => {
    expect(resolveFirebaseConfig({})).toEqual({ enabled: false });
  });

  it('fails closed when FCM is enabled without project id', () => {
    expect(() => resolveFirebaseConfig({ FCM_ENABLED: 'true' })).toThrow(/FCM_CONFIG_MISSING/);
  });

  it('resolves ADC when project id is present', () => {
    const config = resolveFirebaseConfig({
      FCM_ENABLED: 'true',
      FIREBASE_PROJECT_ID: 'caregap-test',
    });
    expect(config).toMatchObject({ enabled: true, projectId: 'caregap-test', credentialSource: 'application_default' });
  });
});

describe('Phase 2-A payload safety', () => {
  it('builds conservative lock-screen copy without sensitive fields', () => {
    const payload = buildSafePushPayload({
      notification_id: notificationId,
      event: sampleEvent(),
      category: 'appointment',
      destination: { type: 'APPOINTMENT', resource_id: resourceId },
    });
    expect(payload.title).toBe(LOCK_SCREEN_DEFAULT_TITLE);
    expect(payload.body).toBe(LOCK_SCREEN_DEFAULT_BODY);
    expect(payload.data).not.toHaveProperty('person_id');
    expect(JSON.stringify(payload)).not.toMatch(/상담 원문|주민|복약/);
  });

  it('rejects sensitive data keys', () => {
    expect(() => buildSafePushPayload({
      notification_id: notificationId,
      event: {
        ...sampleEvent(),
        metadata: { record_text: '상담 원문 노출 시도' },
      },
      category: 'analysis',
      destination: { type: 'ANALYSIS', resource_id: resourceId },
    })).not.toThrow();
    // metadata is not copied into push data — only typed SafePushData fields.
    const payload = buildSafePushPayload({
      notification_id: notificationId,
      event: sampleEvent(),
      category: 'analysis',
      destination: { type: 'ANALYSIS', resource_id: resourceId },
    });
    expect(Object.keys(payload.data).sort()).toEqual([
      'category',
      'destination_resource_id',
      'destination_type',
      'event_id',
      'notification_id',
    ]);
  });
});

describe('Phase 2-A error classification', () => {
  it('marks unregistered tokens for deactivation', () => {
    expect(classifyFcmErrorCode('messaging/registration-token-not-registered')).toMatchObject({
      error_class: 'unregistered',
      retryable: false,
      deactivate_device: true,
    });
  });

  it('marks unavailable as transient retryable', () => {
    expect(classifyFcmErrorCode('messaging/server-unavailable')).toMatchObject({
      error_class: 'transient',
      retryable: true,
    });
  });
});

describe('Phase 2-A MockPushProvider', () => {
  it('records per-device success without claiming real Firebase delivery', async () => {
    const mock = new MockPushProvider();
    const payload = buildSafePushPayload({
      notification_id: notificationId,
      event: sampleEvent(),
      category: 'appointment',
      destination: { type: 'APPOINTMENT', resource_id: resourceId },
    });
    const response = await mock.send({
      targets: [{
        device_registration_id: '11111111-1111-4111-8111-111111111111',
        platform: 'android',
        registration_token: 'test-registration-token-android-001',
      }],
      payload,
    });
    expect(mock.name).toBe('mock');
    expect(response.results[0]?.result.outcome).toBe('success');
    expect(mock.sent).toHaveLength(1);
  });

  it('supports partial failure per device', async () => {
    const mock = new MockPushProvider();
    mock.behavior = {
      mode: 'per_device',
      results: {
        '11111111-1111-4111-8111-111111111111': {
          outcome: 'failure',
          error_class: 'unregistered',
          error_code: 'messaging/registration-token-not-registered',
          retryable: false,
          deactivate_device: true,
        },
      },
      defaultResult: { outcome: 'success', provider_message_id: 'ok' },
    };
    const payload = buildSafePushPayload({
      notification_id: notificationId,
      event: sampleEvent(),
      category: 'appointment',
      destination: { type: 'APPOINTMENT', resource_id: resourceId },
    });
    const response = await mock.send({
      targets: [
        {
          device_registration_id: '11111111-1111-4111-8111-111111111111',
          platform: 'ios',
          registration_token: 'test-registration-token-ios-001234',
        },
        {
          device_registration_id: '22222222-2222-4222-8222-222222222222',
          platform: 'android',
          registration_token: 'test-registration-token-android-002',
        },
      ],
      payload,
    });
    expect(response.results[0]?.result.outcome).toBe('failure');
    expect(response.results[1]?.result.outcome).toBe('success');
  });
});

describe('Phase 2-A FcmPushProvider message mapping', () => {
  it('maps multicast responses per target without network I/O', async () => {
    const provider = FcmPushProvider.forMessaging({
      async sendEachForMulticast(message) {
        expect(message.tokens).toHaveLength(2);
        expect(message.notification?.title).toBe(LOCK_SCREEN_DEFAULT_TITLE);
        expect(message.data).not.toHaveProperty('person_id');
        return {
          responses: [
            { success: true, messageId: 'projects/x/messages/1' },
            { success: false, error: { code: 'messaging/registration-token-not-registered' } },
          ],
        };
      },
    });
    const payload = buildSafePushPayload({
      notification_id: notificationId,
      event: sampleEvent(),
      category: 'appointment',
      destination: { type: 'APPOINTMENT', resource_id: resourceId },
    });
    const response = await provider.send({
      targets: [
        {
          device_registration_id: '11111111-1111-4111-8111-111111111111',
          platform: 'android',
          registration_token: 'token-a-abcdefghijklmnopqrstuvwxyz',
        },
        {
          device_registration_id: '22222222-2222-4222-8222-222222222222',
          platform: 'ios',
          registration_token: 'token-b-abcdefghijklmnopqrstuvwxyz',
        },
      ],
      payload,
    });
    expect(response.results[0]?.result).toMatchObject({ outcome: 'success' });
    expect(response.results[1]?.result).toMatchObject({
      outcome: 'failure',
      deactivate_device: true,
    });
  });
});
