import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { NotificationAuthPort } from './auth-adapter.js';
import { DeviceRegistrationInput, toPublicDevice, type DeviceRegistrationRepository } from './devices.js';
import type { InAppNotificationStore } from './in-app-store.js';
import {
  NotificationPreferencesPatch,
  type NotificationPreferenceRepository,
} from './preferences.js';
import { utcIso, type Clock } from './clock.js';
import { randomUUID } from 'node:crypto';

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

async function requireActor(auth: NotificationAuthPort, req: Request, res: Response) {
  const result = await auth.authenticate(req.get('authorization') ?? undefined);
  if (!result.authenticated) {
    res.status(401).json(errorBody('UNAUTHENTICATED', result.reason));
    return null;
  }
  return result.actor;
}

/**
 * Notification HTTP surface. Does not expose arbitrary push-to-user.
 * Manual POST /api/notifications creation is intentionally omitted from this router.
 */
export function createNotificationRouter(deps: {
  auth: NotificationAuthPort;
  store: InAppNotificationStore;
  preferences: NotificationPreferenceRepository;
  devices: DeviceRegistrationRepository;
  clock: Clock;
}): Router {
  const router = Router();

  router.get('/notifications', async (req, res) => {
    const actor = await requireActor(deps.auth, req, res);
    if (!actor) return;
    const query = z.object({
      unread: z.enum(['true', 'false']).optional(),
      kind: z.string().min(1).optional(),
      category: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }).parse(req.query);
    const listed = deps.store.list(actor.user_id, {
      unread_only: query.unread === 'true',
      kind: query.kind,
      category: query.category,
      limit: query.limit,
      offset: query.offset,
    });
    if (listed.outcome !== 'listed') {
      res.status(403).json(errorBody('FORBIDDEN', listed.reason));
      return;
    }
    res.json({ data: { notifications: listed.notifications, unread_count: listed.unread_count } });
  });

  router.get('/notifications/unread-count', async (req, res) => {
    const actor = await requireActor(deps.auth, req, res);
    if (!actor) return;
    res.json({ data: { unread_count: deps.store.unreadCount(actor.user_id) } });
  });

  router.post('/notifications/:id/read', async (req, res) => {
    const actor = await requireActor(deps.auth, req, res);
    if (!actor) return;
    const result = deps.store.markRead(actor.user_id, String(req.params.id), utcIso(deps.clock.now()));
    if (result.outcome === 'rejected') {
      // Hide existence of other users' notifications.
      res.status(404).json(errorBody('NOT_FOUND', 'Notification not found'));
      return;
    }
    res.json({ data: result.notification });
  });

  router.get('/notification-preferences', async (req, res) => {
    const actor = await requireActor(deps.auth, req, res);
    if (!actor) return;
    const preferences = await deps.preferences.get(actor.user_id);
    res.json({ data: preferences });
  });

  router.patch('/notification-preferences', async (req, res) => {
    const actor = await requireActor(deps.auth, req, res);
    if (!actor) return;
    const patch = NotificationPreferencesPatch.parse(req.body);
    // Always update self only — ignore any client-supplied user_id.
    const updated = await deps.preferences.update(
      actor.user_id,
      actor.user_id,
      patch,
      utcIso(deps.clock.now()),
    );
    if (updated.outcome === 'rejected') {
      res.status(403).json(errorBody('FORBIDDEN', updated.reason));
      return;
    }
    res.json({ data: updated.preferences });
  });

  router.post('/notification-devices', async (req, res) => {
    const actor = await requireActor(deps.auth, req, res);
    if (!actor) return;
    const input = DeviceRegistrationInput.parse(req.body);
    const device = await deps.devices.upsert(
      actor.user_id,
      input,
      utcIso(deps.clock.now()),
      () => randomUUID(),
    );
    res.status(201).json({ data: toPublicDevice(device) });
  });

  router.delete('/notification-devices/:id', async (req, res) => {
    const actor = await requireActor(deps.auth, req, res);
    if (!actor) return;
    const result = await deps.devices.deactivate(
      actor.user_id,
      String(req.params.id),
      utcIso(deps.clock.now()),
    );
    if (result.outcome === 'rejected') {
      res.status(result.reason === 'owner_mismatch' ? 403 : 404).json(
        errorBody(result.reason === 'owner_mismatch' ? 'FORBIDDEN' : 'NOT_FOUND', result.reason),
      );
      return;
    }
    res.json({ data: toPublicDevice(result.device) });
  });

  router.post('/notification-devices/logout', async (req, res) => {
    const actor = await requireActor(deps.auth, req, res);
    if (!actor) return;
    const count = await deps.devices.deactivateAllForUser(actor.user_id, utcIso(deps.clock.now()));
    res.json({ data: { deactivated: count } });
  });

  return router;
}
