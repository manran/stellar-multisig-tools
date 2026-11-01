BEGIN;

ALTER TABLE mst_stellar.human_notification_outbox
  ADD COLUMN provider_delivery_state text
    CHECK (provider_delivery_state IN ('delivered', 'bounced')),
  ADD COLUMN provider_event_at timestamptz,
  ADD COLUMN provider_event_id text;

CREATE INDEX human_notification_outbox_provider_message_idx
  ON mst_stellar.human_notification_outbox (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0013_human_notification_provider_events');

COMMIT;
