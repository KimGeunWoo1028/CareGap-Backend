-- Draft only. scripts/migrate.ts reads migrations/*.sql and does not read this directory.
-- Do not move this file to migrations/ until:
--   1) migrations/0001_be1_create_users_table.sql is applied
--   2) BE2 consultations draft that creates public.notifications (and appointments/follow_ups) is accepted
--   3) BE1 + BE2 review the additive delivery schema
-- Runner permits only loopback caregap_local. Do not apply to shared/production DBs from this branch.
--
-- This draft does NOT recreate appointments, consultations, follow_up_tasks, or notifications.
-- It assumes public.notifications already exists with the BE2 draft columns.
-- person_id remains a care-subject id and is never equated to user_id.

-- Additive navigation columns on existing notifications (safe if already present — apply once).
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS category text,
    ADD COLUMN IF NOT EXISTS destination_type text,
    ADD COLUMN IF NOT EXISTS destination_resource_id uuid;

COMMENT ON COLUMN notifications.category IS 'Phase 2 notification category. Open string aligned with app enum.';
COMMENT ON COLUMN notifications.destination_type IS 'Typed navigation destination. Never an external URL.';
COMMENT ON COLUMN notifications.destination_resource_id IS 'Resource id for destination_type. Access must be re-checked on click.';

CREATE TABLE device_registrations (
    device_registration_id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    platform text NOT NULL,
    installation_id text NOT NULL,
    registration_token text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    last_active_at timestamptz NOT NULL,
    CONSTRAINT device_registrations_platform_present CHECK (char_length(platform) > 0),
    CONSTRAINT device_registrations_installation_present CHECK (char_length(installation_id) > 0),
    CONSTRAINT device_registrations_token_present CHECK (char_length(registration_token) > 0),
    CONSTRAINT device_registrations_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT device_registrations_user_installation_key UNIQUE (user_id, installation_id)
);

CREATE INDEX device_registrations_user_active_idx ON device_registrations (user_id) WHERE active;
CREATE INDEX device_registrations_token_idx ON device_registrations (registration_token);

COMMENT ON TABLE device_registrations IS 'FCM registration targets. registration_token must not appear in API logs.';
COMMENT ON COLUMN device_registrations.installation_id IS 'Client app-install id. Not a user_id.';

CREATE TABLE notification_preferences (
    user_id uuid PRIMARY KEY,
    push_enabled boolean NOT NULL DEFAULT true,
    in_app_enabled boolean NOT NULL DEFAULT true,
    category_appointment boolean NOT NULL DEFAULT true,
    category_consultation boolean NOT NULL DEFAULT true,
    category_message boolean NOT NULL DEFAULT true,
    category_analysis boolean NOT NULL DEFAULT true,
    category_welfare_review boolean NOT NULL DEFAULT true,
    category_reminder boolean NOT NULL DEFAULT true,
    category_admin boolean NOT NULL DEFAULT true,
    category_system boolean NOT NULL DEFAULT true,
    lock_screen_rich_preview boolean NOT NULL DEFAULT false,
    updated_at timestamptz,
    CONSTRAINT notification_preferences_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

COMMENT ON TABLE notification_preferences IS 'CareGap in-app preference. OS notification permission is separate and cannot be bypassed.';
COMMENT ON COLUMN notification_preferences.lock_screen_rich_preview IS 'PROVISIONAL. Default false = conservative lock-screen copy.';

CREATE TABLE notification_outbox (
    outbox_id uuid PRIMARY KEY,
    idempotency_key text NOT NULL,
    event_id uuid NOT NULL,
    notification_id uuid NOT NULL,
    recipient_user_id uuid NOT NULL,
    channel text NOT NULL,
    status text NOT NULL,
    scheduled_at timestamptz NOT NULL,
    attempt_count integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL,
    last_error_code text,
    claim_owner text,
    claim_expires_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT notification_outbox_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT notification_outbox_channel_present CHECK (char_length(channel) > 0),
    CONSTRAINT notification_outbox_status_present CHECK (char_length(status) > 0),
    CONSTRAINT notification_outbox_attempts_nonnegative CHECK (attempt_count >= 0),
    CONSTRAINT notification_outbox_recipient_fk FOREIGN KEY (recipient_user_id) REFERENCES users (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT notification_outbox_notification_fk FOREIGN KEY (notification_id) REFERENCES notifications (notification_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX notification_outbox_due_idx ON notification_outbox (status, next_attempt_at);
CREATE INDEX notification_outbox_recipient_idx ON notification_outbox (recipient_user_id);
CREATE INDEX notification_outbox_event_idx ON notification_outbox (event_id);

COMMENT ON TABLE notification_outbox IS 'Transactional outbox for push intent. FCM calls happen outside the write transaction.';
COMMENT ON COLUMN notification_outbox.idempotency_key IS 'Prevents duplicate logical send intents. External FCM delivery remains at-least-once.';

-- Worker claim pattern (PostgreSQL):
--   SELECT ... FROM notification_outbox
--   WHERE status IN ('pending','failed_transient') AND next_attempt_at <= now()
--   ORDER BY next_attempt_at
--   FOR UPDATE SKIP LOCKED
--   LIMIT $n;

REVOKE ALL ON TABLE device_registrations FROM PUBLIC;
REVOKE ALL ON TABLE notification_preferences FROM PUBLIC;
REVOKE ALL ON TABLE notification_outbox FROM PUBLIC;
