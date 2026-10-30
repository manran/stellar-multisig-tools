BEGIN;

CREATE TABLE mst_stellar.classic_request_assignments (
  request_id text NOT NULL REFERENCES mst_stellar.classic_requests(id) ON DELETE CASCADE,
  signer_address text NOT NULL,
  assigned_by_address text NOT NULL,
  assigned_at timestamptz NOT NULL,
  PRIMARY KEY (request_id, signer_address)
);

CREATE INDEX classic_request_assignments_signer_idx
  ON mst_stellar.classic_request_assignments
  (signer_address, assigned_at DESC, request_id);

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0010_request_assignments');

COMMIT;
