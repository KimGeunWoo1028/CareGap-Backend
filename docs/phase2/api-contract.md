# Notification API Contract

Envelope matches existing CareGap style:

```json
{ "data": {} }
```

```json
{ "error": { "code": "ERROR_CODE", "message": "..." } }
```

## Routes (Phase 2 router)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/notifications` | required | newest first; filters `unread`, `kind`, `category`, `limit`, `offset` |
| GET | `/api/notifications/unread-count` | required | |
| POST | `/api/notifications/:id/read` | required | idempotent; foreign id → 404 |
| GET | `/api/notification-preferences` | required | self |
| PATCH | `/api/notification-preferences` | required | self only |
| POST | `/api/notification-devices` | required | no client `user_id` |
| DELETE | `/api/notification-devices/:id` | required | owner only |
| POST | `/api/notification-devices/logout` | required | deactivate all |

## Intentionally omitted

- Public “send push to arbitrary user”
- Outbox admin/worker HTTP for end users
- Manual create notification on this router (demo `final-be2` still has memory POST for synthetic sessions)

## Main app wiring

`createApp` mounts the router with `unsetNotificationAuth` → **401** until BE1 adapter is connected.
