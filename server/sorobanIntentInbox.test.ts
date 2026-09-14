import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import { initializeSorobanGAccountAuthorizationWindow } from '../src/stellar/sorobanAuthorization.js';
import { createSorobanAuthorizationPlan } from '../src/stellar/sorobanAuthorizationPlan.js';
import { createSorobanIntent, materializeSorobanIntent } from '../src/stellar/sorobanIntent.js';
import { createStoredSorobanIntent } from './sorobanIntentService.js';
import {
  listSorobanIntentInbox,
  projectSorobanIntentViewerAction,
} from './sorobanIntentInbox.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntent,
  StoredSorobanIntentAuthorizationContribution,
} from './sorobanIntentStore.js';

class MemoryIntentStore implements SorobanIntentStore {
  values = new Map<string, StoredSorobanIntent>();
  contributions = new Map<string, StoredSorobanIntentAuthorizationContribution[]>();
  async createIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async getIntent(id: string) { return this.values.get(id) ?? null; }
  async updateIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async listIntentsBySigner() { return [...this.values.values()]; }
  async listContributions(id: string) { return this.contributions.get(id) ?? []; }
  async putContribution(id: string, value: StoredSorobanIntentAuthorizationContribution) {
    this.contributions.set(id, [...(this.contributions.get(id) ?? []), value]);
  }
}

function accountSnapshot(authorizer: string, signer: string) {
  return {
    accountId: authorizer,
    sequence: '1',
    subentryCount: 1,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [{ key: signer, type: 'ed25519_public_key' as const, weight: 1 }],
  };
}

async function fixture() {
  const authorizer = Keypair.random();
  const signer = Keypair.random();
  const creator = Keypair.random();
  const source = Keypair.random();
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
  const auth = new xdr.SorobanAuthorizationEntry({
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
  });
  const initialized = await initializeSorobanGAccountAuthorizationWindow({
    envelopeXdr: raw.toXDR(),
    network: 'testnet',
    currentLedger: 100,
  });
  const plan = createSorobanAuthorizationPlan(intent, initialized);
  const store = new MemoryIntentStore();
  const stored = await createStoredSorobanIntent(store, {
    intent,
    authorizationPlan: plan,
    creatorAddress: creator.publicKey(),
    discoverySignerKeys: [signer.publicKey()],
  }, { idFactory: () => 'N'.repeat(16), now: new Date('2026-09-14T10:00:00Z') });
  const options = {
    accountLoader: async () => accountSnapshot(authorizer.publicKey(), signer.publicKey()),
    networkParametersLoader: async () => ({
      ledgerSequence: 100,
      ledgerClosedAt: '2026-09-14T10:00:00Z',
      baseFeeInStroops: 100,
      baseReserveInStroops: 5_000_000,
    }),
  };
  return { store, stored, signer, creator, options };
}

test('Intent Inbox treats discovery as candidates and revalidates live signer authority', async () => {
  const f = await fixture();
  const signerInbox = await listSorobanIntentInbox(
    f.store,
    f.signer.publicKey(),
    'testnet',
    f.options,
  );
  assert.equal(signerInbox.length, 1);
  assert.equal(signerInbox[0]?.id, f.stored.id);
  assert.equal(signerInbox[0]?.viewerAction, 'authorize');

  const staleCandidate = await listSorobanIntentInbox(
    f.store,
    Keypair.random().publicKey(),
    'testnet',
    f.options,
  );
  assert.deepEqual(staleCandidate, []);

  const creatorInbox = await listSorobanIntentInbox(
    f.store,
    f.creator.publicKey(),
    'testnet',
    f.options,
  );
  assert.equal(creatorInbox[0]?.viewerAction, 'waiting');
});

test('ready and blocked Intent states project to execution and attention actions', () => {
  const base = {
    id: 'N'.repeat(16),
    network: 'testnet' as const,
    intentDigest: 'intent',
    authorizationPlanDigest: 'plan',
    executionBinding: 'detached' as const,
    authorizationEntriesXdr: [],
    contributionCount: 0,
    authorizers: [],
  };
  assert.equal(projectSorobanIntentViewerAction({
    ...base,
    status: 'authorization_ready',
  }, Keypair.random().publicKey()), 'execute');
  assert.equal(projectSorobanIntentViewerAction({
    ...base,
    status: 'blocked',
    statusDetail: 'unsupported',
  }, Keypair.random().publicKey()), 'attention');
});
