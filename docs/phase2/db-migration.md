# DB Migration Notes

## Applied on upstream/main

- `migrations/0001_be1_create_users_table.sql` only

## Drafts (not applied by runner)

- Wave A / BE2 consultations draft (notifications table) lives on other branches under `migrations/drafts/`
- Phase 2 additive draft: `migrations/drafts/0003_be2_notification_phase2.sql`

## Phase 2 draft contents

- `ALTER TABLE notifications` add `category`, `destination_type`, `destination_resource_id`
- `device_registrations`
- `notification_preferences`
- `notification_outbox` with unique `idempotency_key`

## Apply rules

- Runner only allows loopback `caregap_local`
- Do not apply to shared/production from this branch
- Do not `CREATE` existing domain tables
- Require BE1/BE2 review before moving draft → `migrations/`
