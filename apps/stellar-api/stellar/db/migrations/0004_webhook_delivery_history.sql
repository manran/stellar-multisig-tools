BEGIN;

CREATE TABLE mst_stellar.integration_webhook_deliveries (
  delivery_id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES mst_stellar.integration_outbox(event_id) ON DELETE CASCADE,
  service_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  endpoint_hash text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  outcome text CHECK (
    outcome IS NULL OR outcome IN ('succeeded', 'retry', 'permanent_failure')
  ),
  http_status integer CHECK (
    http_status IS NULL OR (http_status >= 100 AND http_status <= 599)
  ),
  error_code text,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE (event_id, attempt)
);

CREATE INDEX integration_webhook_deliveries_service_idx
  ON mst_stellar.integration_webhook_deliveries
  (service_id, started_at DESC, delivery_id DESC);

CREATE INDEX integration_webhook_deliveries_event_idx
  ON mst_stellar.integration_webhook_deliveries
  (event_id, attempt);

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0004_webhook_delivery_history');

COMMIT;
