import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Address,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Networks,
  TransactionBuilder,
  SorobanDataBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import { initializeSorobanGAccountAuthorizationWindow } from '../src/stellar/sorobanAuthorization.js';
import { createSorobanIntent, materializeSorobanIntent } from '../src/stellar/sorobanIntent.js';
import { createImportedSorobanIntent } from './importedSorobanIntentService.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

class MemoryIntentStore implements SorobanIntentStore {
  values = new Map<string, StoredSorobanIntent>();
  async createIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async getIntent(id: string) { return this.values.get(id) ?? null; }
  async updateIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async listContributions() { return []; }
  async putContribution() {}
}

async function fixture(sourceBound = false) {
  const source = Keypair.random();
  const authorizer = Keypair.random();
  const signer = Keypair.random();
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const args = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'approve_invoice',
    args: [nativeToScVal(authorizer.publicKey())],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
    subInvocations: [],
  });
  const auth = sourceBound
    ? new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
        rootInvocation: invocation,
      })
    : new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
          address: new Address(authorizer.publicKey()).toScAddress(),
          nonce: xdr.Int64(42n),
          signatureExpirationLedger: 0,
          signature: xdr.ScVal.scvVoid(),
        })),
        rootInvocation: invocation,
      });
  const intent = createSorobanIntent('testnet', xdr.HostFunction.hostFunctionTypeInvokeContract(args));
  const raw = materializeSorobanIntent({
    intent,
    sourceAccount: source.publicKey(),
    sourceSequence: '7',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [auth],
    sorobanData: new SorobanDataBuilder().build(),
  });
  const preparedXdr = sourceBound ? raw.toXDR() : await initializeSorobanGAccountAuthorizationWindow({
    envelopeXdr: raw.toXDR(),
    network: 'testnet',
    currentLedger: 100,
  });
  const options = {
    accountLoader: async (address: string) => ({
      accountId: address,
      sequence: '1',
      subentryCount: 0,
      numSponsoring: 0,
      numSponsored: 0,
      thresholds: { low: 1, medium: 1, high: 1 },
      signers: address === authorizer.publicKey()
        ? [{ key: signer.publicKey(), type: 'ed25519_public_key' as const, weight: 1 }]
        : [{ key: address, type: 'ed25519_public_key' as const, weight: 1 }],
    }),
    networkParametersLoader: async () => ({
      ledgerSequence: 100,
      ledgerClosedAt: '2026-09-14T10:00:00Z',
      baseFeeInStroops: 100,
      baseReserveInStroops: 5_000_000,
    }),
  };
  return { source, authorizer, signer, preparedXdr, intent, options };
}

test('prepared XDR import keeps Intent and detached auth but discards the transaction shell', async () => {
  const f = await fixture();
  const store = new MemoryIntentStore();
  const creator = Keypair.random().publicKey();
  const stored = await createImportedSorobanIntent(store, creator, {
    network: 'testnet',
    preparedXdr: f.preparedXdr,
    privateNote: 'Imported review',
  }, {
    ...f.options,
    idFactory: () => 'P'.repeat(16),
    now: new Date('2026-09-14T10:00:00Z'),
  });

  assert.equal(stored.intent.intentDigest, f.intent.intentDigest);
  assert.equal(stored.authorizationPlan.executionBinding, 'detached');
  assert.deepEqual(stored.discoverySignerKeys, [creator, f.signer.publicKey()].sort());
  assert.equal(stored.privateContext?.initialPrivateNote?.text, 'Imported review');
  assert.equal('transactionSource' in stored, false);
  assert.equal('preparedXdr' in stored, false);
});


test('prepared XDR import rejects SOURCE_ACCOUNT authorization', async () => {
  const f = await fixture(true);
  const store = new MemoryIntentStore();
  await assert.rejects(
    () => createImportedSorobanIntent(store, Keypair.random().publicKey(), {
      network: 'testnet',
      preparedXdr: f.preparedXdr,
    }, f.options),
    (cause: unknown) => cause instanceof Error
      && 'code' in cause
      && cause.code === 'source_account_auth_unsupported',
  );
  assert.equal(store.values.size, 0);
});

test('prepared XDR import rejects transaction-envelope signatures', async () => {
  const f = await fixture();
  const parsed = TransactionBuilder.fromXDR(f.preparedXdr, Networks.TESTNET);
  if (parsed instanceof FeeBumpTransaction) throw new Error('unexpected fee bump');
  parsed.sign(f.source);
  const store = new MemoryIntentStore();
  await assert.rejects(
    () => createImportedSorobanIntent(store, Keypair.random().publicKey(), {
      network: 'testnet', preparedXdr: parsed.toXDR(),
    }, f.options),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'prepared_xdr_already_signed',
  );
});
