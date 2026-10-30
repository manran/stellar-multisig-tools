BEGIN;

CREATE TABLE mst_stellar.human_notification_outbox (
  event_id text PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type = 'signature_requested'),
  request_id text NOT NULL REFERENCES mst_stellar.classic_requests(id) ON DELETE CASCADE,
  recipient_signer_address text NOT NULL,
  actor_address text NOT NULL,
  destination_email text,
  created_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  lease_token text,
  lease_until timestamptz,
  completed_at timestamptz,
  outcome text CHECK (outcome IN ('sent', 'permanent_failure')),
  provider_message_id text,
  terminal_error_code text
);

CREATE INDEX human_notification_outbox_due_idx
  ON mst_stellar.human_notification_outbox
  (available_at, created_at, event_id)
  WHERE completed_at IS NULL;

CREATE TABLE mst_stellar.human_notification_deliveries (
  delivery_id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES mst_stellar.human_notification_outbox(event_id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  outcome text CHECK (outcome IN ('succeeded', 'retry', 'permanent_failure')),
  provider_message_id text,
  http_status integer,
  error_code text,
  duration_ms integer,
  UNIQUE (event_id, attempt)
);

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0011_human_notifications');

COMMIT;
