BEGIN;

-- A signer may delegate creation of one fixed payment template without granting a Stellar signature.
-- Each grant period is immutable history; only its revocation time is updated.
CREATE TABLE mst_stellar.reusable_template_proposer_grants (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id text NOT NULL REFERENCES mst_stellar.reusable_templates(id) ON DELETE RESTRICT,
  proposer_address text NOT NULL,
  granted_by_address text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_address text
);
CREATE UNIQUE INDEX reusable_template_active_proposer_idx
  ON mst_stellar.reusable_template_proposer_grants (template_id, proposer_address)
  WHERE revoked_at IS NULL;
CREATE INDEX reusable_template_proposer_lookup_idx
  ON mst_stellar.reusable_template_proposer_grants (proposer_address, template_id)
  WHERE revoked_at IS NULL;

ALTER TABLE mst_stellar.classic_requests ADD COLUMN proposer_address text;
CREATE INDEX classic_requests_proposer_idx
  ON mst_stellar.classic_requests (network, proposer_address, created_at DESC, id DESC)
  WHERE proposer_address IS NOT NULL;

INSERT INTO mst_stellar.schema_migrations (version) VALUES ('0016_template_proposers');
COMMIT;
