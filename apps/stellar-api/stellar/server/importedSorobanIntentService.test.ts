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
  inspectAuthEntry,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import { initializeSorobanGAccountAuthorizationWindow } from '../../../../packages/stellar-core/src/sorobanAuthorization.js';
import { createSorobanIntent, materializeSorobanIntent } from '../../../../packages/stellar-core/src/sorobanIntent.js';
import { emptySorobanEffectsSnapshot } from '../../../../packages/stellar-core/src/sorobanEffects.js';
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
    simulator: async ({ envelopeXdr }: { envelopeXdr: string }) => ({ assembledXdr: envelopeXdr, latestLedger: 100, effects: emptySorobanEffectsSnapshot() } as never),
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

const CONTRACT_ACCOUNT = 'CBUGCD3J6RCTJ5RVK7SGDV63JKV7E5YMULD5HAXQ7BGHNLB5DYVVZIEH';

async function withImportContractAdapter<T>(ownerAddress: string, run: () => Promise<T>): Promise<T> {
  const contractKey = 'STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT';
  const ownerKey = 'STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_OWNER';
  const previousContract = process.env[contractKey];
  const previousOwner = process.env[ownerKey];
  process.env[contractKey] = CONTRACT_ACCOUNT;
  process.env[ownerKey] = ownerAddress;
  try {
    return await run();
  } finally {
    if (previousContract === undefined) delete process.env[contractKey];
    else process.env[contractKey] = previousContract;
    if (previousOwner === undefined) delete process.env[ownerKey];
    else process.env[ownerKey] = previousOwner;
  }
}

function contractPreparedXdr(signed = false) {
  const source = Keypair.random();
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const args = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'authorize',
    args: [nativeToScVal(CONTRACT_ACCOUNT), nativeToScVal(303)],
  });  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
    subInvocations: [],
  });
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(CONTRACT_ACCOUNT).toScAddress(),
      nonce: xdr.Int64(99n),
      signatureExpirationLedger: signed ? 460 : 0,
      signature: signed ? xdr.ScVal.scvBytes(Buffer.alloc(64, 7)) : xdr.ScVal.scvVoid(),
    })),
    rootInvocation: invocation,
  });
  const intent = createSorobanIntent('testnet', xdr.HostFunction.hostFunctionTypeInvokeContract(args));
  const transaction = materializeSorobanIntent({
    intent,
    sourceAccount: source.publicKey(),
    sourceSequence: '7',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [auth],
    sorobanData: new SorobanDataBuilder().build(),
  });
  return { intent, preparedXdr: transaction.toXDR() };
}
test('prepared XDR import initializes configured C-account AUTH and discovers its owner', async () => {
  const owner = Keypair.random();
  await withImportContractAdapter(owner.publicKey(), async () => {
    const f = contractPreparedXdr(false);
    const store = new MemoryIntentStore();
    const creator = Keypair.random().publicKey();
    const stored = await createImportedSorobanIntent(store, creator, {
      network: 'testnet',
      preparedXdr: f.preparedXdr,
    }, {
      networkParametersLoader: async () => ({
        ledgerSequence: 100,
        ledgerClosedAt: '2026-09-14T10:00:00Z',
        baseFeeInStroops: 100,
        baseReserveInStroops: 5_000_000,
      }),
      accountLoader: async () => { throw new Error('C-account import should not load the contract through Horizon.'); },
      simulator: async ({ envelopeXdr }: { envelopeXdr: string }) => ({ assembledXdr: envelopeXdr, latestLedger: 100, effects: emptySorobanEffectsSnapshot() } as never),
      idFactory: () => 'Q'.repeat(16),
    });
    const entry = xdr.SorobanAuthorizationEntry.fromXdr(stored.authorizationPlan.authorizationEntriesXdr[0], 'base64');
    const info = inspectAuthEntry(entry);
    assert.equal(info.signatureExpirationLedger, 460);
    assert.equal(info.signed, false);
    assert.deepEqual(stored.discoverySignerKeys, [creator, owner.publicKey()].sort());
  });
});
test('prepared XDR import rejects pre-staged C-account credential evidence', async () => {
  const owner = Keypair.random();
  await withImportContractAdapter(owner.publicKey(), async () => {
    const f = contractPreparedXdr(true);
    const store = new MemoryIntentStore();
    await assert.rejects(
      () => createImportedSorobanIntent(store, owner.publicKey(), {
        network: 'testnet',
        preparedXdr: f.preparedXdr,
      }, {
        networkParametersLoader: async () => ({
          ledgerSequence: 100,
          ledgerClosedAt: '2026-09-14T10:00:00Z',
          baseFeeInStroops: 100,
          baseReserveInStroops: 5_000_000,
        }),
      }),
      (cause: unknown) => cause instanceof Error
        && 'code' in cause
        && cause.code === 'contract_account_auth_import_unsupported',
    );
    assert.equal(store.values.size, 0);
  });
});
