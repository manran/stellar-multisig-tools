import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import {
  authenticateIntegrationCredential,
  configuredIntegrationCredentials,
  createIntegrationApiKey,
  IntegrationCredentialServiceError,
  integrationCallerForCredential,
  looksLikeIntegrationCredential,
} from './integrationCredentialService.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const apiKey = `msi_fednetwork_${'a'.repeat(43)}`;
const configured = [{
  serviceId: 'fednetwork',
  label: 'FedNetwork',
  secretHash: sha256(apiKey),
  networks: ['testnet' as const],
  classicSourceAccounts: ['GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'],
  classicExternalExecutionSourceAccounts: [],
  sorobanContracts: [{ contractId: 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE', methods: ['transfer'] }],
  sorobanExecutionAccounts: ['GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'],
}];

test('configured Integration credential authenticates as an independent Service workload caller', () => {
  const credential = authenticateIntegrationCredential(apiKey, configured);
  assert.equal(credential.serviceId, 'fednetwork');
  assert.deepEqual(integrationCallerForCredential(credential), {
    type: 'service', id: 'fednetwork', label: 'FedNetwork',
  });
  assert.equal(looksLikeIntegrationCredential(apiKey), true);
  assert.equal(looksLikeIntegrationCredential('msa_other_secret'), false);
});

test('Integration credential rejects the wrong secret without exposing configuration', () => {
  assert.throws(
    () => authenticateIntegrationCredential(`msi_fednetwork_${'b'.repeat(43)}`, configured),
    (cause: unknown) => cause instanceof IntegrationCredentialServiceError
      && cause.status === 401
      && cause.code === 'invalid_integration_credential',
  );
});

test('Integration credential configuration is deployment-owned JSON', () => {
  const parsed = configuredIntegrationCredentials(JSON.stringify(configured));
  assert.deepEqual(parsed, configured);
  assert.deepEqual(configuredIntegrationCredentials(''), []);
});

test('malformed Integration credential configuration fails closed', () => {
  assert.throws(
    () => configuredIntegrationCredentials('{bad json'),
    (cause: unknown) => cause instanceof IntegrationCredentialServiceError
      && cause.status === 503
      && cause.code === 'integration_credential_config_invalid',
  );
  assert.throws(
    () => configuredIntegrationCredentials(JSON.stringify([
      ...configured,
      { ...configured[0], label: 'Duplicate' },
    ])),
    (cause: unknown) => cause instanceof IntegrationCredentialServiceError
      && cause.code === 'integration_credential_config_invalid',
  );
});

test('Classic external execution scope must be a subset of Classic coordination scope', () => {
  assert.throws(
    () => configuredIntegrationCredentials(JSON.stringify([{
      ...configured[0],
      classicSourceAccounts: [],
      classicExternalExecutionSourceAccounts: configured[0].classicSourceAccounts,
    }])),
    (cause: unknown) => cause instanceof IntegrationCredentialServiceError
      && cause.code === 'integration_credential_config_invalid'
      && /must also be present in classicSourceAccounts/.test(cause.message),
  );
});

test('deployment operator can generate a one-time msi credential and retain only its verifier hash', () => {
  const generated = createIntegrationApiKey('fednetwork');
  assert.match(generated.apiKey, /^msi_fednetwork_[A-Za-z0-9_-]{32,128}$/);
  const scoped = { ...configured[0], secretHash: generated.secretHash };
  assert.equal(authenticateIntegrationCredential(generated.apiKey, [scoped]).serviceId, 'fednetwork');
  assert.equal(generated.secretHash, sha256(generated.apiKey));
});

test('Soroban contract execution can bind one contract to an executor from the global pool', () => {
  const executor = configured[0].sorobanExecutionAccounts[0];
  const parsed = configuredIntegrationCredentials(JSON.stringify([{
    ...configured[0],
    sorobanContracts: [{
      ...configured[0].sorobanContracts[0],
      execution: { mode: 'external', executor },
    }],
  }]));
  assert.deepEqual(parsed[0]?.sorobanContracts[0]?.execution, { mode: 'external', executor });

  assert.throws(
    () => configuredIntegrationCredentials(JSON.stringify([{
      ...configured[0],
      sorobanContracts: [{
        ...configured[0].sorobanContracts[0],
        execution: { mode: 'external', executor: Keypair.random().publicKey() },
      }],
    }])),
    (cause: unknown) => cause instanceof IntegrationCredentialServiceError
      && cause.code === 'integration_credential_config_invalid'
      && /Contract executor/.test(cause.message),
  );
});

test('Soroban contract can explicitly require MultiSigTools-managed execution', () => {
  const parsed = configuredIntegrationCredentials(JSON.stringify([{
    ...configured[0],
    sorobanContracts: [{
      ...configured[0].sorobanContracts[0],
      execution: { mode: 'multisigtools' },
    }],
  }]));
  assert.deepEqual(parsed[0]?.sorobanContracts[0]?.execution, { mode: 'multisigtools' });
});

test('Soroban default executor must be inside the Service execution allowlist', () => {
  const defaultExecutor = configured[0].sorobanExecutionAccounts[0];
  const parsed = configuredIntegrationCredentials(JSON.stringify([{
    ...configured[0],
    sorobanDefaultExecutor: defaultExecutor,
  }]));
  assert.equal(parsed[0]?.sorobanDefaultExecutor, defaultExecutor);

  assert.throws(
    () => configuredIntegrationCredentials(JSON.stringify([{
      ...configured[0],
      sorobanDefaultExecutor: Keypair.random().publicKey(),
    }])),
    (cause: unknown) => cause instanceof IntegrationCredentialServiceError
      && cause.code === 'integration_credential_config_invalid'
      && /default executor/.test(cause.message),
  );
});
