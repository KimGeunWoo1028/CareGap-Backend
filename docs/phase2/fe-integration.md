# FE Integration Guide

## List / badge

1. `GET /api/notifications`
2. `GET /api/notifications/unread-count`
3. `POST /api/notifications/:id/read` on open

## Navigation contract

Use only:

```ts
type Destination =
  | { type: 'APPOINTMENT'; resource_id: string }
  | { type: 'MESSAGE'; resource_id: string }
  | { type: 'CONSULTATION'; resource_id: string }
  | { type: 'ANALYSIS'; resource_id: string }
  | { type: 'WELFARE_REVIEW'; resource_id: string }
  | { type: 'FOLLOW_UP'; resource_id: string }
  | { type: 'NONE' };
```

Never trust a URL string inside notification payloads.

On click: confirm session → fetch resource → if 403/404 show safe error (do not use delivery-time permission).

## Admin web

Reuse the same in-app list filtered by `category=admin` (or kind `WELFARE_REVIEW_REQUESTED`). External admin push is deferred.

## Preferences UI

Map toggles to `PATCH /api/notification-preferences`. Explain that OS permission is separate and cannot be forced by CareGap.
