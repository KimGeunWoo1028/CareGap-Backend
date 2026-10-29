# Phase 2 Architecture

## Goals

Unify CareGap event notifications (appointments, messages, consultation results, AI analysis, welfare review, reminders) behind one pipeline with:

- PostgreSQL-oriented persistence contracts (draft)
- In-app notification list/read (reusing existing BE2 pure functions)
- Transactional outbox for push intent
- Firebase Cloud Messaging for device delivery
- Fail-closed identity / relationship checks

## Components (`src/modules/be2-notifications/`)

| Component | Responsibility |
| --- | --- |
| `types.ts` | Event types, categories, destinations, statuses |
| `payload.ts` | Lock-screen-safe title/body/data builder |
| `push-provider.ts` | Provider interface |
| `mock-push-provider.ts` | Test-only; never counts as production FCM success |
| `fcm-push-provider.ts` | `sendEachForMulticast` adapter |
| `firebase-config.ts` | Fail-closed config resolution |
| `preferences.ts` | Per-user push/in-app/category settings |
| `devices.ts` | Device registry (token not exposed in API) |
| `outbox.ts` | Idempotent push intent + claim API |
| `worker.ts` | Claim → load devices → push → retry/deactivate |
| `recipient-resolver.ts` | person≠user; staff assignment; family DENY default |
| `notification-service.ts` | Event orchestration |
| `reminder-scheduler.ts` | PROVISIONAL offsets; unset by default |
| `routes.ts` | Authenticated HTTP surface |
| `auth-adapter.ts` | BE1 auth port (unset in main app) |
| `analysis-event-adapter.ts` | Maps `analysis.succeeded/failed` |

## Existing code reused

- `src/modules/be2-consultations/notification.ts` — accept/list/read pure functions
- `final-be2.ts` memory notification routes remain demo-only synthetic auth (not production)
- `AuthorizationPort` concept in `shared/contracts.ts`

## Memory vs PostgreSQL

Main `createApp` mounts notification routes with **in-memory** stores and **unset** auth (401). This is intentional until BE1 JWT + loopback `caregap_local` schema review land.

SQL draft: `migrations/drafts/0003_be2_notification_phase2.sql` (not auto-applied).

## Transactional outbox note

When domain mutations already live in PostgreSQL, write notification rows + outbox rows in the same transaction, then let workers send FCM asynchronously.

The final demo server (`final-be2.ts`) is memory-backed; same-transaction durability is **not** available there. Use explicit event adapters + idempotency keys instead.
