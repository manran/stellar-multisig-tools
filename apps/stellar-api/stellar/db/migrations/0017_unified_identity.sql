BEGIN;

-- Authentication is separate from Stellar transaction authority.
CREATE TABLE mst_stellar.mst_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mst_stellar.mst_auth_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES mst_stellar.mst_users(id),
  kind text NOT NULL CHECK (kind IN ('stellar_wallet', 'passkey')),
  subject text NOT NULL,
  public_key bytea,
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  device_type text,
  backed_up boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT mst_auth_credential_kind_shape CHECK (
    (kind = 'stellar_wallet' AND public_key IS NULL)
    OR (kind = 'passkey' AND public_key IS NOT NULL)
  )
);
CREATE UNIQUE INDEX mst_auth_credential_identity_idx
  ON mst_stellar.mst_auth_credentials(kind, subject);
CREATE INDEX mst_auth_credential_user_idx
  ON mst_stellar.mst_auth_credentials(user_id, created_at);

CREATE TABLE mst_stellar.mst_template_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id text NOT NULL REFERENCES mst_stellar.reusable_templates(id),
  network text NOT NULL CHECK (network IN ('public', 'testnet')),
  token_hash bytea NOT NULL UNIQUE,
  invited_by_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES mst_stellar.mst_users(id),
  revoked_at timestamptz
);
CREATE INDEX mst_template_invitation_owner_idx
  ON mst_stellar.mst_template_invitations(template_id, created_at DESC);

CREATE TABLE mst_stellar.mst_template_user_grants (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id text NOT NULL REFERENCES mst_stellar.reusable_templates(id),
  user_id uuid NOT NULL REFERENCES mst_stellar.mst_users(id),
  invited_by_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_address text
);
CREATE UNIQUE INDEX mst_template_active_user_grant_idx
  ON mst_stellar.mst_template_user_grants(template_id, user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX mst_template_user_lookup_idx
  ON mst_stellar.mst_template_user_grants(user_id, template_id)
  WHERE revoked_at IS NULL;

CREATE TABLE mst_stellar.mst_webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('register', 'authenticate')),
  user_id uuid,
  invitation_id uuid REFERENCES mst_stellar.mst_template_invitations(id),
  network text NOT NULL CHECK (network IN ('public', 'testnet')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX mst_webauthn_challenge_expiry_idx
  ON mst_stellar.mst_webauthn_challenges(expires_at);

ALTER TABLE mst_stellar.classic_requests
  ADD COLUMN proposer_user_id uuid REFERENCES mst_stellar.mst_users(id);
CREATE INDEX classic_requests_proposer_user_idx
  ON mst_stellar.classic_requests(network, proposer_user_id, created_at DESC, id DESC)
  WHERE proposer_user_id IS NOT NULL;

INSERT INTO mst_stellar.schema_migrations(version) VALUES ('0017_unified_identity');
COMMIT;
