BEGIN;
ALTER TABLE mst_stellar.soroban_intents ADD COLUMN authorizer_accounts text[], ADD COLUMN creation_input_hash text;
CREATE INDEX soroban_intents_authorizer_lookup_idx ON mst_stellar.soroban_intents USING gin (authorizer_accounts);
CREATE INDEX soroban_intent_activity_creator_idx ON mst_stellar.soroban_intents (network, creator_address, id);
CREATE INDEX soroban_intent_activity_contributor_idx ON mst_stellar.soroban_auth_contributions (signer_address, intent_id);
INSERT INTO mst_stellar.schema_migrations (version) VALUES ('0021_soroban_discovery_and_replay');
COMMIT;
