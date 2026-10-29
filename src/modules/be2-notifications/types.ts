import { z } from 'zod';
import { Id } from '../../shared/contracts.js';

/** Lock-screen / category preferences. Mandatory-notification policy is PROVISIONAL / unset. */
export const NotificationCategory = z.enum([
  'appointment',
  'consultation',
  'message',
  'analysis',
  'welfare_review',
  'reminder',
  'admin',
  'system',
]);
export type NotificationCategory = z.infer<typeof NotificationCategory>;

/** Typed navigation only — never an external URL or executable string. */
export const DestinationType = z.enum([
  'APPOINTMENT',
  'MESSAGE',
  'CONSULTATION',
  'ANALYSIS',
  'WELFARE_REVIEW',
  'FOLLOW_UP',
  'NONE',
]);
export type DestinationType = z.infer<typeof DestinationType>;

export const NotificationDestination = z.object({
  type: DestinationType,
  resource_id: Id.optional(),
}).strict();
export type NotificationDestination = z.infer<typeof NotificationDestination>;

/**
 * Domain event names for Phase 2. Prefer existing domain types when present
 * (e.g. analysis.succeeded / analysis.failed) and normalize at the adapter boundary.
 */
export const NotificationEventType = z.enum([
  'APPOINTMENT_REQUESTED',
  'APPOINTMENT_ACCEPTED',
  'APPOINTMENT_REJECTED',
  'APPOINTMENT_RESCHEDULED',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_REMINDER_DUE',
  'MESSAGE_RECEIVED',
  'CONSULTATION_RESULT_REGISTERED',
  'ANALYSIS_COMPLETED',
  'ANALYSIS_FAILED',
  'WELFARE_REVIEW_REQUESTED',
  'WELFARE_REVIEW_COMPLETED',
  'CALL_INVITATION_CREATED',
  'CALL_INVITATION_CANCELLED',
  'CALL_MISSED',
]);
export type NotificationEventType = z.infer<typeof NotificationEventType>;

export const DomainNotificationEvent = z.object({
  event_id: Id,
  event_type: NotificationEventType,
  occurred_at: z.iso.datetime(),
  actor_user_id: Id.optional(),
  person_id: Id.optional(),
  resource_type: DestinationType,
  resource_id: Id.optional(),
  event_version: z.number().int().positive().default(1),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
}).strict();
export type DomainNotificationEvent = z.infer<typeof DomainNotificationEvent>;

export const PushChannel = z.enum(['fcm', 'in_app_only']);
export type PushChannel = z.infer<typeof PushChannel>;

export const OutboxStatus = z.enum([
  'pending',
  'claimed',
  'sent',
  'failed_transient',
  'failed_permanent',
  'cancelled',
]);
export type OutboxStatus = z.infer<typeof OutboxStatus>;

export const DevicePlatform = z.enum(['ios', 'android', 'web']);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

export type PushErrorClass =
  | 'invalid_token'
  | 'unregistered'
  | 'transient'
  | 'rate_limited'
  | 'payload'
  | 'auth_config'
  | 'unknown';

export type DeliveryAttemptResult =
  | { outcome: 'success'; provider_message_id?: string }
  | { outcome: 'failure'; error_class: PushErrorClass; error_code: string; retryable: boolean; deactivate_device?: boolean };

export const LOCK_SCREEN_DEFAULT_TITLE = 'CareGap';
export const LOCK_SCREEN_DEFAULT_BODY = '새로운 알림이 있습니다.';

/** PROVISIONAL: conservative lock-screen policy until product confirms richer previews. */
export const LockScreenPolicyMode = z.enum(['conservative', 'provisional_rich']);
export type LockScreenPolicyMode = z.infer<typeof LockScreenPolicyMode>;
