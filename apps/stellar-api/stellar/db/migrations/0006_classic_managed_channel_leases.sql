BEGIN;

CREATE TABLE mst_stellar.classic_managed_channel_leases (
  network text NOT NULL CHECK (network IN ('public', 'testnet')),
  channel_account text NOT NULL,
  request_id text NOT NULL UNIQUE,
  leased_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (network, channel_account)
);

CREATE INDEX classic_managed_channel_leases_expiry_idx
  ON mst_stellar.classic_managed_channel_leases (expires_at);

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0006_classic_managed_channel_leases');

COMMIT;
