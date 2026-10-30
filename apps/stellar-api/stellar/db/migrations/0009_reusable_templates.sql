BEGIN;

CREATE TABLE mst_stellar.reusable_templates (
  id text PRIMARY KEY,
  owner_address text NOT NULL,
  network text NOT NULL CHECK (network IN ('public', 'testnet')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('payment', 'batch_payment')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz
);

CREATE INDEX reusable_templates_owner_network_idx
  ON mst_stellar.reusable_templates
  (owner_address, network, archived_at, updated_at DESC, id);

CREATE TABLE mst_stellar.reusable_template_versions (
  template_id text NOT NULL REFERENCES mst_stellar.reusable_templates(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (template_id, version)
);

ALTER TABLE mst_stellar.classic_requests
  ADD COLUMN reusable_template_id text,
  ADD COLUMN reusable_template_version integer,
  ADD CONSTRAINT classic_requests_reusable_template_pair CHECK (
    (reusable_template_id IS NULL AND reusable_template_version IS NULL)
    OR (reusable_template_id IS NOT NULL AND reusable_template_version IS NOT NULL)
  ),
  ADD CONSTRAINT classic_requests_reusable_template_fk
    FOREIGN KEY (reusable_template_id, reusable_template_version)
    REFERENCES mst_stellar.reusable_template_versions(template_id, version)
    ON DELETE RESTRICT;

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0009_reusable_templates');

COMMIT;
