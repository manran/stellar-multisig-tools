BEGIN;

ALTER TABLE mst_stellar.classic_managed_channel_leases
  ADD COLUMN channel_index bigint;

ALTER TABLE mst_stellar.classic_managed_channel_leases
  ADD CONSTRAINT classic_managed_channel_index_nonnegative
  CHECK (channel_index IS NULL OR channel_index >= 0);

CREATE UNIQUE INDEX classic_managed_channel_leases_index_idx
  ON mst_stellar.classic_managed_channel_leases (network, channel_index)
  WHERE channel_index IS NOT NULL;

INSERT INTO mst_stellar.schema_migrations (version)
VALUES ('0007_classic_managed_channel_index');

COMMIT;
