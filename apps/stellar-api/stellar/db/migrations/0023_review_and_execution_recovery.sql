BEGIN;
ALTER TABLE mst_stellar.classic_requests ADD COLUMN review_source_accounts jsonb;
ALTER TABLE mst_stellar.soroban_execution_preparations ADD COLUMN released_execution jsonb;
INSERT INTO mst_stellar.schema_migrations (version) VALUES ('0023_review_and_execution_recovery');
COMMIT;
