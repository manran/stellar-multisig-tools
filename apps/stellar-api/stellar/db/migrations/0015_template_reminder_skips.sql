BEGIN;
ALTER TABLE mst_stellar.human_notification_outbox DROP CONSTRAINT IF EXISTS human_notification_outbox_outcome_check;
ALTER TABLE mst_stellar.human_notification_outbox ADD CONSTRAINT human_notification_outbox_outcome_check CHECK (outcome IN ('sent', 'permanent_failure', 'skipped'));
INSERT INTO mst_stellar.schema_migrations (version) VALUES ('0015_template_reminder_skips');
COMMIT;
