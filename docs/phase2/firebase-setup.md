# Firebase Setup Guide

## Dependency

- `firebase-admin@14.5.0` (Node `>=22`, matches project engines)

## Environment

```bash
FCM_ENABLED=false
# FIREBASE_PROJECT_ID=your-project-id
# GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json
# or FIREBASE_SERVICE_ACCOUNT_PATH=...
# or FIREBASE_SERVICE_ACCOUNT_JSON=...  (local sealed secret only; never commit)
```

## Fail-closed behavior

- `FCM_ENABLED=true` without project id → throws `FCM_CONFIG_MISSING`
- Missing credentials are not silently replaced with `MockPushProvider`
- Mock success must never be reported as real Firebase delivery

## Send API used

Admin SDK `Messaging.sendEachForMulticast` with registration tokens, Android/APNs display options, and string-only `data` map.

Partial success/failure is recorded per device. Invalid/unregistered tokens are deactivated.

## Security

- Do not commit service account JSON
- Do not log full registration tokens or bearer tokens
- Restrict service account to FCM send permissions only
