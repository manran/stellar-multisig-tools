BEGIN;

ALTER TABLE mst_stellar.classic_requests
  ADD COLUMN has_private_data boolean NOT NULL DEFAULT false;

ALTER TABLE mst_stellar.soroban_intents
  ADD COLUMN has_private_note boolean NOT NULL DEFAULT false;

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0002_private_context_flags');

COMMIT;
