# Device Registry

## Fields

- `device_registration_id`
- `user_id` (from auth, never from client body)
- `platform` (`ios` | `android` | `web`)
- `installation_id` (app install id)
- `registration_token` (FCM target; omitted from API responses)
- `active`, `created_at`, `updated_at`, `last_active_at`

## Behaviors

- Upsert by `(user_id, installation_id)`
- Token rotation updates the same row
- Same token appearing under another install deactivates previous active rows
- Logout deactivates all devices for the authenticated user
- Cross-user delete → forbidden

## API

- `POST /api/notification-devices`
- `DELETE /api/notification-devices/:id`
- `POST /api/notification-devices/logout`
