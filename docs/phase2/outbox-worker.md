# Outbox / Worker

## Outbox job

- Unique `idempotency_key` prevents duplicate logical intents
- Statuses: `pending`, `claimed`, `sent`, `failed_transient`, `failed_permanent`, `cancelled`
- `scheduled_at` / `next_attempt_at` in UTC
- Claim fields support multi-worker lease recovery

## Worker

1. Claim due rows (`FOR UPDATE SKIP LOCKED` in SQL; mutex in memory repo)
2. Load active devices for recipient
3. Build conservative payload
4. Call `PushProvider.send` **outside** DB transaction
5. On success → `sent`
6. On retryable failure → backoff + jitter
7. On permanent / max attempts → `failed_permanent`
8. On invalid/unregistered token → deactivate device registration

## Delivery semantics

- Internal intent: idempotent
- External FCM: **at-least-once** (network retries may duplicate)
- Do not claim exactly-once device delivery

## Reminders

`ReminderScheduler` cancels by appointment idempotency prefix on reschedule/cancel.
Default policy is **unset** (no production schedule until confirmed).
