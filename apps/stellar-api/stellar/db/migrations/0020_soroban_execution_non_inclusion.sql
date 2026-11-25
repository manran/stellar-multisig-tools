BEGIN;
ALTER TABLE mst_stellar.soroban_execution_preparations ADD COLUMN non_inclusion_proof jsonb;
INSERT INTO mst_stellar.schema_migrations (version) VALUES ('0020_soroban_execution_non_inclusion');
COMMIT;
