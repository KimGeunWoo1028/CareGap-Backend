import type { DomainNotificationEvent, NotificationCategory, NotificationDestination } from './types.js';

export type EventNotificationPlan = {
  category: NotificationCategory;
  destination: NotificationDestination;
  /** Staff typically receives these; patient/family via resolver. */
  audience: 'patient_staff_family' | 'patient_family' | 'admin' | 'message_peer';
  enqueue_push: boolean;
};

export function planForEvent(event: DomainNotificationEvent): EventNotificationPlan {
  switch (event.event_type) {
    case 'APPOINTMENT_REQUESTED':
    case 'APPOINTMENT_RESCHEDULED':
    case 'APPOINTMENT_CANCELLED':
      return {
        category: 'appointment',
        destination: { type: 'APPOINTMENT', resource_id: event.resource_id },
        audience: 'patient_staff_family',
        enqueue_push: true,
      };
    case 'APPOINTMENT_ACCEPTED':
    case 'APPOINTMENT_REJECTED':
      return {
        category: 'appointment',
        destination: { type: 'APPOINTMENT', resource_id: event.resource_id },
        audience: 'patient_family',
        enqueue_push: true,
      };
    case 'APPOINTMENT_REMINDER_DUE':
      return {
        category: 'reminder',
        destination: { type: 'APPOINTMENT', resource_id: event.resource_id },
        audience: 'patient_staff_family',
        enqueue_push: true,
      };
    case 'MESSAGE_RECEIVED':
      return {
        category: 'message',
        destination: { type: 'MESSAGE', resource_id: event.resource_id },
        audience: 'message_peer',
        enqueue_push: true,
      };
    case 'CONSULTATION_RESULT_REGISTERED':
      return {
        category: 'consultation',
        destination: { type: 'CONSULTATION', resource_id: event.resource_id },
        audience: 'patient_staff_family',
        enqueue_push: true,
      };
    case 'ANALYSIS_COMPLETED':
    case 'ANALYSIS_FAILED':
      return {
        category: 'analysis',
        destination: { type: 'ANALYSIS', resource_id: event.resource_id },
        audience: 'patient_staff_family',
        enqueue_push: true,
      };
    case 'WELFARE_REVIEW_REQUESTED':
      return {
        category: 'admin',
        destination: { type: 'WELFARE_REVIEW', resource_id: event.resource_id },
        audience: 'admin',
        enqueue_push: false, // admin external push deferred until policy confirmed
      };
    case 'WELFARE_REVIEW_COMPLETED':
      return {
        category: 'welfare_review',
        destination: { type: 'WELFARE_REVIEW', resource_id: event.resource_id },
        audience: 'patient_staff_family',
        enqueue_push: true,
      };
    case 'CALL_INVITATION_CREATED':
    case 'CALL_INVITATION_CANCELLED':
    case 'CALL_MISSED':
      // Phase 3 VoIP is separate; these are ordinary FCM event contracts only.
      return {
        category: 'system',
        destination: { type: 'NONE', resource_id: event.resource_id },
        audience: 'patient_staff_family',
        enqueue_push: true,
      };
    default: {
      const _exhaustive: never = event.event_type;
      return _exhaustive;
    }
  }
}

/** Normalize BE3 analysis.succeeded / analysis.failed into Phase 2 event types. */
export function normalizeAnalysisDomainType(
  type: 'analysis.succeeded' | 'analysis.failed',
): 'ANALYSIS_COMPLETED' | 'ANALYSIS_FAILED' {
  return type === 'analysis.succeeded' ? 'ANALYSIS_COMPLETED' : 'ANALYSIS_FAILED';
}
