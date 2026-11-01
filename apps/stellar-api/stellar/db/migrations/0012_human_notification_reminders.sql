BEGIN;

ALTER TABLE mst_stellar.human_notification_outbox
  DROP CONSTRAINT IF EXISTS human_notification_outbox_event_type_check;

ALTER TABLE mst_stellar.human_notification_outbox
  ADD CONSTRAINT human_notification_outbox_event_type_check
  CHECK (event_type IN ('signature_requested', 'signature_reminder'));

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0012_human_notification_reminders');

COMMIT;
