BEGIN;
ALTER TABLE mst_stellar.mst_users ADD COLUMN nickname text NOT NULL DEFAULT '' CHECK (char_length(nickname) <= 64);
INSERT INTO mst_stellar.schema_migrations(version) VALUES ('0019_user_nickname');
COMMIT;
