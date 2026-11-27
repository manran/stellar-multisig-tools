BEGIN;
-- Advisory metadata observed at creation. Never affects authorization or execution.
ALTER TABLE mst_stellar.soroban_intents ADD COLUMN review_token_metadata jsonb;
INSERT INTO mst_stellar.schema_migrations (version) VALUES ('0024_soroban_review_token_observation');
COMMIT;
