# CareGap Phase 2 — Integrated Notification System

Branch: `feature/be2-notification-phase2` (from `upstream/main` @ merge of PR #23).

This package implements the **general** CareGap notification pipeline (NTF-01~08), not Phase 3 VoIP/CallKit/LiveKit.

## Status legend

| Label | Meaning |
| --- | --- |
| IMPLEMENTED | Code + automated tests in this branch |
| PARTIAL | Core path exists; domain source or policy incomplete |
| BLOCKED | Fail-closed pending BE1/policy/mobile |
| NOT VERIFIED | Requires external credentials, shared DB, or real devices |

## Module map

```
Domain Event
  → NotificationService / event adapters
  → NotificationRecipientResolver (fail-closed)
  → Preferences + NotificationPolicy hooks
  → InAppNotificationStore (reuses be2-consultations/notification.ts)
  → Notification Outbox
  → NotificationWorker
  → PushProvider (FcmPushProvider | MockPushProvider)
```

In-app persistence and FCM I/O are intentionally separated. FCM is never called inside a DB write transaction.

## Documents

1. [Architecture](./architecture.md)
2. [Requirement traceability NTF-01~08](./ntf-traceability.md)
3. [Event contract](./event-contract.md)
4. [Recipient & authorization policy](./recipient-policy.md)
5. [Firebase setup](./firebase-setup.md)
6. [Device registry](./device-registry.md)
7. [DB migration draft](./db-migration.md)
8. [Outbox / worker](./outbox-worker.md)
9. [API contract](./api-contract.md)
10. [FE integration](./fe-integration.md)
11. [iOS / Android integration](./mobile-integration.md)
12. [Test & verification report](./verification-report.md)
13. [Ops incident notes](./ops-runbook.md)
14. [Open team decisions](./open-decisions.md)

## Non-goals (Phase 3)

- WebRTC / LiveKit room join
- iOS PushKit VoIP / CallKit UI
- Android full-screen call UI
- Call state machine / recording / STT
