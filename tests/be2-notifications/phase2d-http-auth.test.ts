import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { fixedActorAuth, unsetNotificationAuth } from '../../src/modules/be2-notifications/auth-adapter.js';
import { systemClock } from '../../src/modules/be2-notifications/clock.js';
import { MemoryDeviceRegistrationRepository } from '../../src/modules/be2-notifications/devices.js';
import { InAppNotificationStore } from '../../src/modules/be2-notifications/in-app-store.js';
import { MemoryNotificationPreferenceRepository } from '../../src/modules/be2-notifications/preferences.js';
import { createNotificationRouter } from '../../src/modules/be2-notifications/routes.js';

const actorA = {
  user_id: '33333333-3333-4333-8333-333333333333',
  role: 'patient' as const,
};
const actorB = {
  user_id: '44444444-4444-4444-8444-444444444444',
  role: 'patient' as const,
};

function buildApp(actor = actorA) {
  const store = new InAppNotificationStore();
  const preferences = new MemoryNotificationPreferenceRepository();
  const devices = new MemoryDeviceRegistrationRepository();
  const app = express();
  app.use(express.json());
  app.use('/api', createNotificationRouter({
    auth: fixedActorAuth(actor),
    store,
    preferences,
    devices,
    clock: systemClock(),
  }));
  return { app, store, preferences, devices };
}

describe('Phase 2-D notification HTTP auth', () => {
  it('rejects unauthenticated access when auth port is unset', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createNotificationRouter({
      auth: unsetNotificationAuth,
      store: new InAppNotificationStore(),
      preferences: new MemoryNotificationPreferenceRepository(),
      devices: new MemoryDeviceRegistrationRepository(),
      clock: systemClock(),
    }));
    await request(app).get('/api/notifications').expect(401);
  });

  it('lists only the authenticated user notifications and hides foreign reads', async () => {
    const { app, store } = buildApp(actorA);
    store.create({
      recipient_user_id: actorA.user_id,
      kind: 'MESSAGE_RECEIVED',
      title: '새 메시지',
      body: '새로운 메시지가 도착했습니다.',
      created_at: '2026-10-30T00:00:00.000Z',
      category: 'message',
      destination: { type: 'MESSAGE', resource_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      notification_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    store.create({
      recipient_user_id: actorB.user_id,
      kind: 'MESSAGE_RECEIVED',
      title: '새 메시지',
      body: '다른 사용자 알림',
      created_at: '2026-10-30T00:00:00.000Z',
      category: 'message',
      destination: { type: 'MESSAGE', resource_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      notification_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    const listed = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer test')
      .expect(200);
    expect(listed.body.data.notifications).toHaveLength(1);
    expect(listed.body.data.notifications[0].recipient_user_id).toBe(actorA.user_id);

    await request(app)
      .post('/api/notifications/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/read')
      .set('Authorization', 'Bearer test')
      .expect(404);
  });

  it('updates preferences for self only and registers devices without trusting body user_id', async () => {
    const { app } = buildApp(actorA);
    const prefs = await request(app)
      .patch('/api/notification-preferences')
      .set('Authorization', 'Bearer test')
      .send({ push_enabled: false, categories: { message: false } })
      .expect(200);
    expect(prefs.body.data.push_enabled).toBe(false);
    expect(prefs.body.data.user_id).toBe(actorA.user_id);

    const device = await request(app)
      .post('/api/notification-devices')
      .set('Authorization', 'Bearer test')
      .send({
        platform: 'android',
        installation_id: 'install-abc-001',
        registration_token: 'fcm-token-abcdefghijklmnopqrstuvwxyz',
        user_id: actorB.user_id, // ignored / rejected by schema
      });
    // unknown field rejected by zod strict input on DeviceRegistrationInput
    expect(device.status).toBeGreaterThanOrEqual(400);

    const ok = await request(app)
      .post('/api/notification-devices')
      .set('Authorization', 'Bearer test')
      .send({
        platform: 'android',
        installation_id: 'install-abc-001',
        registration_token: 'fcm-token-abcdefghijklmnopqrstuvwxyz',
      })
      .expect(201);
    expect(ok.body.data.user_id).toBe(actorA.user_id);
    expect(ok.body.data).not.toHaveProperty('registration_token');
    expect(ok.body.data.registration_token_fingerprint).toMatch(/^fp_/);
  });

  it('marks read idempotently', async () => {
    const { app, store } = buildApp(actorA);
    store.create({
      recipient_user_id: actorA.user_id,
      kind: 'APPOINTMENT_ACCEPTED',
      title: '예약 수락',
      body: '상담 예약이 수락되었습니다.',
      created_at: '2026-10-30T00:00:00.000Z',
      notification_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    const first = await request(app)
      .post('/api/notifications/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/read')
      .set('Authorization', 'Bearer test')
      .expect(200);
    const second = await request(app)
      .post('/api/notifications/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/read')
      .set('Authorization', 'Bearer test')
      .expect(200);
    expect(first.body.data.read_at).toBeTruthy();
    expect(second.body.data.read_at).toBe(first.body.data.read_at);

    const unread = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', 'Bearer test')
      .expect(200);
    expect(unread.body.data.unread_count).toBe(0);
  });
});
