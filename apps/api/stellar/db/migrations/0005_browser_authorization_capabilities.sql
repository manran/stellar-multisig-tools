BEGIN;

CREATE TABLE mst_stellar.soroban_browser_authorization_capabilities (
  capability_id text PRIMARY KEY,
  intent_id text NOT NULL REFERENCES mst_stellar.soroban_intents(id) ON DELETE CASCADE,
  integration_service_id text NOT NULL,
  signer_address text NOT NULL,
  authorization_plan_revision integer NOT NULL CHECK (authorization_plan_revision >= 1),
  authorization_plan_digest text NOT NULL,
  origin text NOT NULL,
  secret_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX soroban_browser_authorization_capabilities_intent_idx
  ON mst_stellar.soroban_browser_authorization_capabilities
  (intent_id, authorization_plan_revision, signer_address, created_at DESC);

CREATE INDEX soroban_browser_authorization_capabilities_expiry_idx
  ON mst_stellar.soroban_browser_authorization_capabilities
  (expires_at);

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0005_browser_authorization_capabilities');

COMMIT;
