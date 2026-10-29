import { z } from 'zod';
import { Id } from '../../shared/contracts.js';
import { NotificationCategory } from './types.js';

/**
 * Push master switch vs in-app storage are separate.
 * OS permission is client-side and cannot be bypassed by the server.
 *
 * Mandatory notification scope is UNSET / PROVISIONAL — do not hardcode required categories.
 */
export const NotificationPreferences = z.object({
  user_id: Id,
  push_enabled: z.boolean().default(true),
  in_app_enabled: z.boolean().default(true),
  categories: z.object({
    appointment: z.boolean().default(true),
    consultation: z.boolean().default(true),
    message: z.boolean().default(true),
    analysis: z.boolean().default(true),
    welfare_review: z.boolean().default(true),
    reminder: z.boolean().default(true),
    admin: z.boolean().default(true),
    system: z.boolean().default(true),
  }).default({
    appointment: true,
    consultation: true,
    message: true,
    analysis: true,
    welfare_review: true,
    reminder: true,
    admin: true,
    system: true,
  }),
  /** PROVISIONAL: richer lock-screen text. Default false (conservative). */
  lock_screen_rich_preview: z.boolean().default(false),
  updated_at: z.iso.datetime().optional(),
}).strict();
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

export const NotificationPreferencesPatch = z.object({
  push_enabled: z.boolean().optional(),
  in_app_enabled: z.boolean().optional(),
  categories: z.object({
    appointment: z.boolean().optional(),
    consultation: z.boolean().optional(),
    message: z.boolean().optional(),
    analysis: z.boolean().optional(),
    welfare_review: z.boolean().optional(),
    reminder: z.boolean().optional(),
    admin: z.boolean().optional(),
    system: z.boolean().optional(),
  }).partial().optional(),
  lock_screen_rich_preview: z.boolean().optional(),
}).strict();
export type NotificationPreferencesPatch = z.infer<typeof NotificationPreferencesPatch>;

export type MandatoryNotificationPolicy =
  | { status: 'unset'; reason: 'PROVISIONAL_POLICY_UNSET' }
  | { status: 'configured'; required_categories: NotificationCategory[] };

export const DEFAULT_MANDATORY_POLICY: MandatoryNotificationPolicy = {
  status: 'unset',
  reason: 'PROVISIONAL_POLICY_UNSET',
};

export function defaultPreferences(userId: string): NotificationPreferences {
  return NotificationPreferences.parse({ user_id: userId });
}

export function mergePreferences(
  current: NotificationPreferences,
  patch: NotificationPreferencesPatch,
  updatedAt: string,
): NotificationPreferences {
  return NotificationPreferences.parse({
    user_id: current.user_id,
    push_enabled: patch.push_enabled ?? current.push_enabled,
    in_app_enabled: patch.in_app_enabled ?? current.in_app_enabled,
    categories: {
      ...current.categories,
      ...(patch.categories ?? {}),
    },
    lock_screen_rich_preview: patch.lock_screen_rich_preview ?? current.lock_screen_rich_preview,
    updated_at: updatedAt,
  });
}

export function allowsPushForCategory(
  prefs: NotificationPreferences,
  category: NotificationCategory,
  mandatory: MandatoryNotificationPolicy = DEFAULT_MANDATORY_POLICY,
): boolean {
  if (mandatory.status === 'configured' && mandatory.required_categories.includes(category)) {
    // Even "required" categories respect OS permission (client). Server may still enqueue
    // in-app rows; push still needs push_enabled unless policy explicitly overrides later.
    return prefs.push_enabled && prefs.categories[category];
  }
  return prefs.push_enabled && prefs.categories[category];
}

export function allowsInApp(
  prefs: NotificationPreferences,
  _category: NotificationCategory,
): boolean {
  return prefs.in_app_enabled;
}

export interface NotificationPreferenceRepository {
  get(userId: string): Promise<NotificationPreferences>;
  update(actorUserId: string, targetUserId: string, patch: NotificationPreferencesPatch, updatedAt: string): Promise<
    | { outcome: 'updated'; preferences: NotificationPreferences }
    | { outcome: 'rejected'; reason: 'actor_mismatch' }
  >;
}

export class MemoryNotificationPreferenceRepository implements NotificationPreferenceRepository {
  private readonly store = new Map<string, NotificationPreferences>();

  async get(userId: string): Promise<NotificationPreferences> {
    const existing = this.store.get(userId.toLowerCase());
    if (existing) return existing;
    const created = defaultPreferences(userId);
    this.store.set(userId.toLowerCase(), created);
    return created;
  }

  async update(
    actorUserId: string,
    targetUserId: string,
    patch: NotificationPreferencesPatch,
    updatedAt: string,
  ) {
    if (actorUserId.toLowerCase() !== targetUserId.toLowerCase()) {
      return { outcome: 'rejected' as const, reason: 'actor_mismatch' as const };
    }
    const current = await this.get(targetUserId);
    const next = mergePreferences(current, patch, updatedAt);
    this.store.set(targetUserId.toLowerCase(), next);
    return { outcome: 'updated' as const, preferences: next };
  }
}
