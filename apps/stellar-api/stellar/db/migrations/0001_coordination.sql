BEGIN;

CREATE SCHEMA mst_stellar;

CREATE TABLE mst_stellar.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mst_stellar.classic_requests (
  id text PRIMARY KEY,
  network text NOT NULL CHECK (network IN ('public', 'testnet')),
  base_xdr text NOT NULL,
  transaction_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  creator_address text,
  creator_actor jsonb,
  integration_service_id text,
  integration_context jsonb,
  instruction_digest text,
  execution_policy jsonb,
  discovery_signer_keys text[] NOT NULL DEFAULT '{}',
  capability_hash text,
  soroban_effects_baseline jsonb,
  soroban_origin jsonb,
  CHECK (
    (integration_service_id IS NULL AND integration_context IS NULL)
    OR (integration_service_id IS NOT NULL AND integration_context IS NOT NULL)
  )
);

CREATE INDEX classic_requests_integration_created_idx
  ON mst_stellar.classic_requests (integration_service_id, created_at DESC, id DESC)
  WHERE integration_service_id IS NOT NULL;

CREATE INDEX classic_requests_created_idx
  ON mst_stellar.classic_requests (network, created_at DESC, id DESC);

CREATE TABLE mst_stellar.classic_request_subjects (
  request_id text NOT NULL REFERENCES mst_stellar.classic_requests(id) ON DELETE CASCADE,
  network text NOT NULL CHECK (network IN ('public', 'testnet')),
  purpose text NOT NULL CHECK (purpose IN ('discovery', 'activity')),
  subject_kind text NOT NULL CHECK (subject_kind IN ('account', 'signer')),
  subject_id text NOT NULL,
  PRIMARY KEY (request_id, purpose, subject_kind, subject_id)
);

CREATE INDEX classic_request_subject_lookup_idx
  ON mst_stellar.classic_request_subjects
  (network, purpose, subject_kind, subject_id, request_id);

CREATE TABLE mst_stellar.classic_request_participants (
  request_id text NOT NULL REFERENCES mst_stellar.classic_requests(id) ON DELETE CASCADE,
  address text NOT NULL,
  joined_at timestamptz NOT NULL,
  PRIMARY KEY (request_id, address)
);

CREATE TABLE mst_stellar.classic_signature_contributions (
  request_id text NOT NULL REFERENCES mst_stellar.classic_requests(id) ON DELETE CASCADE,
  digest text NOT NULL,
  received_at timestamptz NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (request_id, digest)
);

CREATE INDEX classic_signature_contributions_time_idx
  ON mst_stellar.classic_signature_contributions (request_id, received_at, digest);

CREATE TABLE mst_stellar.classic_submissions (
  request_id text NOT NULL REFERENCES mst_stellar.classic_requests(id) ON DELETE CASCADE,
  transaction_hash text NOT NULL,
  ledger bigint NOT NULL CHECK (ledger >= 0),
  submitted_at timestamptz NOT NULL,
  PRIMARY KEY (request_id, transaction_hash)
);

CREATE TABLE mst_stellar.classic_activity_events (
  request_id text NOT NULL REFERENCES mst_stellar.classic_requests(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor_address text,
  actor jsonb,
  detail text,
  ledger bigint CHECK (ledger IS NULL OR ledger >= 0),
  PRIMARY KEY (request_id, event_id)
);

CREATE INDEX classic_activity_events_time_idx
  ON mst_stellar.classic_activity_events (request_id, occurred_at, event_id);

CREATE TABLE mst_stellar.soroban_intents (
  id text PRIMARY KEY,
  network text NOT NULL CHECK (network IN ('public', 'testnet')),
  intent_digest text NOT NULL,
  intent jsonb NOT NULL,
  authorization_plan jsonb NOT NULL,
  authorization_plan_revision integer NOT NULL DEFAULT 1 CHECK (authorization_plan_revision >= 1),
  authorization_plan_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  creator_address text,
  creator_actor jsonb,
  integration_service_id text,
  integration_context jsonb,
  external_reference text,
  execution_policy jsonb,
  CHECK (
    (integration_service_id IS NULL AND integration_context IS NULL)
    OR (integration_service_id IS NOT NULL AND integration_context IS NOT NULL)
  )
);

CREATE INDEX soroban_intents_integration_created_idx
  ON mst_stellar.soroban_intents (integration_service_id, created_at DESC, id DESC)
  WHERE integration_service_id IS NOT NULL;

CREATE INDEX soroban_intents_created_idx
  ON mst_stellar.soroban_intents (network, created_at DESC, id DESC);

CREATE TABLE mst_stellar.soroban_intent_signers (
  intent_id text NOT NULL REFERENCES mst_stellar.soroban_intents(id) ON DELETE CASCADE,
  network text NOT NULL CHECK (network IN ('public', 'testnet')),
  signer_address text NOT NULL,
  PRIMARY KEY (intent_id, signer_address)
);

CREATE INDEX soroban_intent_signer_lookup_idx
  ON mst_stellar.soroban_intent_signers (network, signer_address, intent_id);

CREATE TABLE mst_stellar.soroban_auth_contributions (
  intent_id text NOT NULL REFERENCES mst_stellar.soroban_intents(id) ON DELETE CASCADE,
  authorization_plan_revision integer NOT NULL CHECK (authorization_plan_revision >= 1),
  authorization_plan_digest text NOT NULL,
  digest text NOT NULL,
  entry_index integer NOT NULL CHECK (entry_index >= 0),
  signer_address text NOT NULL,
  received_at timestamptz NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (intent_id, authorization_plan_revision, digest)
);

CREATE INDEX soroban_auth_contributions_time_idx
  ON mst_stellar.soroban_auth_contributions
  (intent_id, authorization_plan_revision, received_at, digest);

CREATE TABLE mst_stellar.soroban_execution_bindings (
  intent_id text PRIMARY KEY REFERENCES mst_stellar.soroban_intents(id) ON DELETE CASCADE,
  execution_policy jsonb NOT NULL
);

CREATE TABLE mst_stellar.soroban_execution_preparations (
  intent_id text NOT NULL REFERENCES mst_stellar.soroban_intents(id) ON DELETE CASCADE,
  authorization_plan_revision integer NOT NULL CHECK (authorization_plan_revision >= 1),
  authorization_plan_digest text NOT NULL,
  transaction_hash text NOT NULL,
  execution_source text NOT NULL,
  transaction_sequence text NOT NULL,
  valid_until timestamptz,
  latest_ledger bigint NOT NULL CHECK (latest_ledger >= 0),
  effects_digest text NOT NULL,
  effects_accepted boolean NOT NULL,
  prepared_at timestamptz NOT NULL,
  prepared_by_address text,
  prepared_by jsonb,
  PRIMARY KEY (intent_id, prepared_at, transaction_hash)
);

CREATE INDEX soroban_execution_preparations_current_idx
  ON mst_stellar.soroban_execution_preparations
  (intent_id, authorization_plan_revision, prepared_at DESC, transaction_hash);

CREATE TABLE mst_stellar.soroban_execution_observations (
  intent_id text NOT NULL REFERENCES mst_stellar.soroban_intents(id) ON DELETE CASCADE,
  transaction_hash text NOT NULL,
  authorization_plan_revision integer NOT NULL CHECK (authorization_plan_revision >= 1),
  authorization_plan_digest text NOT NULL,
  execution_source text NOT NULL,
  ledger bigint NOT NULL CHECK (ledger >= 0),
  successful boolean NOT NULL,
  observed_at timestamptz NOT NULL,
  network_created_at timestamptz,
  PRIMARY KEY (intent_id, transaction_hash)
);

CREATE INDEX soroban_execution_observations_time_idx
  ON mst_stellar.soroban_execution_observations
  (intent_id, observed_at, transaction_hash);

CREATE TABLE mst_stellar.soroban_intent_cancellations (
  intent_id text PRIMARY KEY REFERENCES mst_stellar.soroban_intents(id) ON DELETE CASCADE,
  cancelled_at timestamptz NOT NULL,
  authorization_plan_digest text NOT NULL,
  authorization_plan_revision integer NOT NULL CHECK (authorization_plan_revision >= 1),
  cancelled_by_address text,
  cancelled_by jsonb
);

CREATE TABLE mst_stellar.agent_idempotency_claims (
  credential_id text NOT NULL,
  idempotency_hash text NOT NULL,
  operation text CHECK (operation IN ('proposal.create', 'intent.create')),
  resource_id text NOT NULL,
  principal jsonb NOT NULL,
  payload_hash text NOT NULL,
  external_reference text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (credential_id, idempotency_hash)
);

CREATE TABLE mst_stellar.integration_outbox (
  event_id text PRIMARY KEY,
  service_id text NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('classic_request', 'soroban_intent')),
  resource_id text NOT NULL,
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1 CHECK (event_version >= 1),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  published_at timestamptz
);

CREATE INDEX integration_outbox_due_idx
  ON mst_stellar.integration_outbox (available_at, created_at, event_id)
  WHERE published_at IS NULL;

CREATE INDEX integration_outbox_service_idx
  ON mst_stellar.integration_outbox (service_id, created_at DESC, event_id DESC);

CREATE VIEW mst_stellar.integration_work AS
SELECT
  'classic_request'::text AS kind,
  id,
  network,
  integration_service_id AS service_id,
  integration_context ->> 'correlationId' AS external_reference,
  created_at
FROM mst_stellar.classic_requests
WHERE integration_service_id IS NOT NULL
UNION ALL
SELECT
  'soroban_intent'::text AS kind,
  id,
  network,
  integration_service_id AS service_id,
  external_reference,
  created_at
FROM mst_stellar.soroban_intents
WHERE integration_service_id IS NOT NULL;

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0001_coordination');

COMMIT;
