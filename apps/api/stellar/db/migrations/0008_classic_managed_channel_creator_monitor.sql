BEGIN;

CREATE TABLE mst_stellar.classic_managed_channel_creator_monitor (
  network text PRIMARY KEY CHECK (network IN ('testnet', 'public')),
  state text NOT NULL CHECK (state IN ('ready', 'low', 'insufficient')),
  native_balance_stroops bigint NOT NULL CHECK (native_balance_stroops >= 0),
  observed_at timestamptz NOT NULL,
  alerted_at timestamptz
);

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0008_classic_managed_channel_creator_monitor');

COMMIT;
