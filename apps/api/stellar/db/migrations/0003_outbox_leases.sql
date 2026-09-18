BEGIN;

ALTER TABLE mst_stellar.integration_outbox
  ADD COLUMN lease_token text,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN last_attempt_at timestamptz;

DROP INDEX mst_stellar.integration_outbox_due_idx;

CREATE INDEX integration_outbox_due_idx
  ON mst_stellar.integration_outbox (available_at, created_at, event_id)
  WHERE published_at IS NULL;

CREATE INDEX integration_outbox_lease_idx
  ON mst_stellar.integration_outbox (lease_until, available_at, created_at, event_id)
  WHERE published_at IS NULL;

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0003_outbox_leases');

COMMIT;
