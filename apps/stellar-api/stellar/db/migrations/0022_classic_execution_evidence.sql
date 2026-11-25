BEGIN;
ALTER TABLE mst_stellar.classic_requests ADD COLUMN execution_evidence jsonb;
ALTER TABLE mst_stellar.classic_submissions ADD COLUMN ledger_transaction_hash text;
INSERT INTO mst_stellar.schema_migrations (version) VALUES ('0022_classic_execution_evidence');
COMMIT;
