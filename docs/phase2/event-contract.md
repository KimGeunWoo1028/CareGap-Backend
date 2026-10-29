# Notification Event Contract

## Envelope

```json
{
  "event_id": "uuid",
  "event_type": "APPOINTMENT_REQUESTED",
  "occurred_at": "2026-10-30T00:00:00.000Z",
  "actor_user_id": "uuid?",
  "person_id": "uuid?",
  "resource_type": "APPOINTMENT",
  "resource_id": "uuid?",
  "event_version": 1,
  "metadata": {}
}
```

Rules:

- `person_id` is a care subject id, never a login `user_id`.
- `metadata` must not be copied into FCM data payloads.
- Idempotency uses `event_id` + recipient + category + `event_version`.

## Event types

| Type | Category | Destination | Notes |
| --- | --- | --- | --- |
| APPOINTMENT_REQUESTED | appointment | APPOINTMENT | |
| APPOINTMENT_ACCEPTED | appointment | APPOINTMENT | |
| APPOINTMENT_REJECTED | appointment | APPOINTMENT | |
| APPOINTMENT_RESCHEDULED | appointment | APPOINTMENT | cancel+reschedule reminders |
| APPOINTMENT_CANCELLED | appointment | APPOINTMENT | cancel reminders |
| APPOINTMENT_REMINDER_DUE | reminder | APPOINTMENT | policy gated |
| MESSAGE_RECEIVED | message | MESSAGE | domain source may be absent |
| CONSULTATION_RESULT_REGISTERED | consultation | CONSULTATION | |
| ANALYSIS_COMPLETED | analysis | ANALYSIS | from `analysis.succeeded` |
| ANALYSIS_FAILED | analysis | ANALYSIS | from `analysis.failed` |
| WELFARE_REVIEW_REQUESTED | admin | WELFARE_REVIEW | in-app only for now |
| WELFARE_REVIEW_COMPLETED | welfare_review | WELFARE_REVIEW | not welfare *recommendation* |
| CALL_* | system | NONE | Phase 3 VoIP separate |

## Analysis adapter

Existing BE2 `analysis.succeeded` / `analysis.failed` map via `analysisEventToNotificationEvent`.

Accepting an analysis receipt still does **not** automatically emit notifications until a domain owner calls `NotificationService.handleDomainEvent`.
