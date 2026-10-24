import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { POST as preparePayment } from '../routes/payment-prepare.js';
import { createIntegrationApiKey } from './integrationCredentialService.js';

const source = Keypair.random().publicKey();
const destination = Keypair.random().publicKey();
const originalFetch = globalThis.fetch;
const originalConfig = process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON;
const originalNetwork = process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;

function accountBody(accountId: string, sequence: string) {
  return {
    account_id: accountId,
    sequence,
    subentry_count: 0,
    num_sponsoring: 0,
    num_sponsored: 0,
    balances: [{ asset_type: 'native', balance: '100.0000000', selling_liabilities: '0.0000000', buying_liabilities: '0.0000000' }],
    thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
    signers: [{ key: accountId, type: 'ed25519_public_key', weight: 1 }],
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalConfig === undefined) delete process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON;
  else process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = originalConfig;
  if (originalNetwork === undefined) delete process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
  else process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = originalNetwork;
});

test('Integration payment prepare accepts business input and returns exact unsigned XDR', async () => {
  const generated = createIntegrationApiKey('payroll');
  process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'testnet';
  process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = JSON.stringify([{
    serviceId: 'payroll',
    label: 'Payroll',
    secretHash: generated.secretHash,
    networks: ['testnet'],
    classicSourceAccounts: [source],
    classicExternalExecutionSourceAccounts: [],
    sorobanContracts: [],
    sorobanExecutionAccounts: [],
  }]);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes(`/accounts/${source}`)) return Response.json(accountBody(source, '7'));
    if (url.includes(`/accounts/${destination}`)) return Response.json(accountBody(destination, '1'));
    if (url.includes('/ledgers?')) {
      return Response.json({ _embedded: { records: [{ sequence: 99, closed_at: '2026-09-15T15:00:00Z', base_fee_in_stroops: 100, base_reserve_in_stroops: 5_000_000 }] } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  const response = await preparePayment(new Request('https://stellar-testnet.multisig.tools/api/payment-prepare', {
    method: 'POST',
    headers: { Authorization: `Bearer ${generated.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      network: 'testnet',
      sourceAccount: source,
      payments: [{ destination, amount: '2.5', asset: { type: 'native' } }],
      lifetimeSeconds: 3600,
    }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { operation: string; xdr: string; transactionHash: string; paymentCount: number };
  assert.equal(body.operation, 'classic.payment.prepare');
  assert.equal(body.paymentCount, 1);
  assert.equal(body.transactionHash.length, 64);
  const transaction = TransactionBuilder.fromXdr(body.xdr, Networks.TESTNET);
  assert.equal(transaction.signatures.length, 0);
  assert.equal(transaction.operations[0].type, 'payment');
});

test('Integration payment prepare rejects a Classic source outside service scope before Horizon access', async () => {
  const generated = createIntegrationApiKey('payroll');
  process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'testnet';
  process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = JSON.stringify([{
    serviceId: 'payroll', label: 'Payroll', secretHash: generated.secretHash,
    networks: ['testnet'], classicSourceAccounts: [source], classicExternalExecutionSourceAccounts: [],
    sorobanContracts: [], sorobanExecutionAccounts: [],
  }]);
  let fetched = false;
  globalThis.fetch = (async () => { fetched = true; return new Response('unexpected', { status: 500 }); }) as typeof fetch;
  const response = await preparePayment(new Request('https://stellar-testnet.multisig.tools/api/payment-prepare', {
    method: 'POST',
    headers: { Authorization: `Bearer ${generated.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      network: 'testnet',
      sourceAccount: Keypair.random().publicKey(),
      payments: [{ destination, amount: '1', asset: { type: 'native' } }],
    }),
  }));
  assert.equal(response.status, 403);
  const body = await response.json() as { code: string };
  assert.equal(body.code, 'integration_classic_source_account_not_allowed');
  assert.equal(fetched, false);
});
