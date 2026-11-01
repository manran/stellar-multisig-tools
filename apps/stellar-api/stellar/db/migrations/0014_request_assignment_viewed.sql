BEGIN;

ALTER TABLE mst_stellar.classic_request_assignments
  ADD COLUMN viewed_at timestamptz;

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0014_request_assignment_viewed');

COMMIT;
