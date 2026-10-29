# iOS / Android Integration Guide

## Required client steps

1. Initialize FCM SDK
2. Request OS notification permission
3. Obtain registration token
4. `POST /api/notification-devices` with bearer auth
5. Refresh token → upsert same `installation_id`
6. Logout → `POST /api/notification-devices/logout`
7. Handle foreground / background / terminated notification opens via destination contract

## Lock-screen expectations (PROVISIONAL)

Server default:

- title: `CareGap`
- body: `새로운 알림이 있습니다.`

OS may still show/hide previews based on user settings; server cannot bypass OS blocking.

## Platform notes

- **iOS**: APNs setup required for FCM display pushes; VoIP PushKit is Phase 3 and separate
- **Android**: channel configuration is client-side; high priority used for wake delivery best-effort
- Multiple devices per user are supported

## Verification gate

Real-device receive is an E2E gate. Backend unit/integration success alone is **not** mobile verification.
