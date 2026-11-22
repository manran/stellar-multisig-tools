BEGIN;

-- Shared, atomic identity quotas for Cloudflare Tunnel and Vercel runtimes.
-- Store short-lived SHA-256 client identifiers, never raw client addresses.
CREATE TABLE mst_stellar.mst_identity_rate_limits (
  bucket text NOT NULL,
  actor_hash bytea NOT NULL CHECK (octet_length(actor_hash) = 32),
  hits integer NOT NULL CHECK (hits > 0),
  reset_at timestamptz NOT NULL,
  PRIMARY KEY (bucket, actor_hash)
);
CREATE INDEX mst_identity_rate_limits_expiry_idx
  ON mst_stellar.mst_identity_rate_limits(reset_at);

INSERT INTO mst_stellar.schema_migrations(version) VALUES ('0018_identity_rate_limits');
COMMIT;
