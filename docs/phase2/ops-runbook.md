# Ops / Incident Notes (Draft)

## Symptoms → checks

| Symptom | Check |
| --- | --- |
| No pushes | `FCM_ENABLED`, credentials, outbox due rows, device `active` |
| Partial device fail | outbox attempts + deactivated tokens |
| Duplicate alerts | idempotency_key collisions / client double register |
| Sensitive lock-screen text | payload builder regression; reject deploy |
| Auth bypass | notification routes must require BE1 auth adapter |

## Worker recovery

- Expired `claim_expires_at` allows reclaim
- Transient FCM errors retry with exponential backoff + jitter
- Permanent token errors deactivate registration

## Do not

- Point production worker at MockPushProvider
- Apply draft migrations to shared DB without review
- Log tokens / bearer headers
