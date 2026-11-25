import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Address,
  Contract,
  Keypair,
  hash,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import { initializeSorobanGAccountAuthorizationWindow, sorobanAuthorizationEntryPreimageXdr } from '../../../../packages/stellar-core/src/sorobanAuthorization.js';
import { contributeSorobanIntentAuthorization } from './sorobanIntentAuthorizationService.js';
import { createSorobanAuthorizationPlan, authorizationEntriesFromPlan } from '../../../../packages/stellar-core/src/sorobanAuthorizationPlan.js';
import { emptySorobanEffectsSnapshot } from '../../../../packages/stellar-core/src/sorobanEffects.js';
import { createSorobanIntent, materializeSorobanIntent } from '../../../../packages/stellar-core/src/sorobanIntent.js';
import { createStoredSorobanIntent } from './sorobanIntentService.js';
import {
  listAgentSorobanInbox,
  listSorobanIntentInbox,
  projectSorobanIntentViewerAction,
} from './sorobanIntentInbox.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntent,
  StoredSorobanIntentAuthorizationContribution,
  StoredSorobanIntentExecutionObservation,
  StoredSorobanIntentExecutionPreparation,
} from './sorobanIntentStore.js';

class MemoryIntentStore implements SorobanIntentStore {
  values = new Map<string, StoredSorobanIntent>();
  contributions = new Map<string, StoredSorobanIntentAuthorizationContribution[]>();
  preparations = new Map<string, StoredSorobanIntentExecutionPreparation[]>();
  observations = new Map<string, StoredSorobanIntentExecutionObservation[]>();
  async createIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async getIntent(id: string) { return this.values.get(id) ?? null; }
  async updateIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async listIntentsBySigner() { return [...this.values.values()]; }
  async listContributions(id: string) { return this.contributions.get(id) ?? []; }
  async putContribution(id: string, value: StoredSorobanIntentAuthorizationContribution) {
    this.contributions.set(id, [...(this.contributions.get(id) ?? []), value]);
  }
  async listExecutionPreparations(id: string) { return this.preparations.get(id) ?? []; }
  async putExecutionPreparation(id: string, value: StoredSorobanIntentExecutionPreparation) {
    this.preparations.set(id, [...(this.preparations.get(id) ?? []), value]);
  }
  async listExecutionObservations(id: string) { return this.observations.get(id) ?? []; }
  async getExecutionObservation(id: string, hash: string) {
    return (this.observations.get(id) ?? []).find((item) => item.transactionHash === hash) ?? null;
  }
  async putExecutionObservation(id: string, value: StoredSorobanIntentExecutionObservation) {
    this.observations.set(id, [...(this.observations.get(id) ?? []), value]);
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
  const plan = createSorobanAuthorizationPlan(intent, initialized, emptySorobanEffectsSnapshot());
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
  assert.equal(signerInbox[0]?.viewerAction, 'sign');

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

test('dependency failure does not turn a pending Soroban Inbox into an empty success', async () => {
  const f = await fixture();
  await assert.rejects(() => listAgentSorobanInbox(f.store, f.signer.publicKey(), 'testnet', 'read', {
    ...f.options, networkParametersLoader: async () => { throw new Error('RPC unavailable'); },
  }), /RPC unavailable/);
  await assert.rejects(() => listSorobanIntentInbox(f.store, f.signer.publicKey(), 'testnet', {
    ...f.options, accountLoader: async () => { throw new Error('Horizon unavailable'); },
  }), /Horizon unavailable/);
});

test('Read and Sign Agents discover the same current Soroban authorization, with different actions', async () => {
  const f = await fixture();
  const address = f.signer.publicKey();
  const read = await listAgentSorobanInbox(f.store, address, 'testnet', 'read', f.options);
  const sign = await listAgentSorobanInbox(f.store, address, 'testnet', 'sign', f.options);
  assert.equal(read.intents.length, 1);
  assert.equal(read.tasks.length, 1);
  assert.equal(read.tasks[0].id, read.intents[0].id);
  assert.equal(read.tasks[0].kind, 'soroban_contract');
  assert.equal(read.tasks[0].signatureRequired, true);
  assert.equal(read.tasks[0].state, 'waiting');
  assert.equal(read.tasks[0].nextActions[0].available, false);
  assert.equal(sign.tasks[0].state, 'action_required');
  assert.equal(sign.tasks[0].nextActions[0].code, 'contribute_authorization');
  assert.equal(sign.tasks[0].nextActions[0].available, true);
  assert.deepEqual(await listAgentSorobanInbox(f.store, Keypair.random().publicKey(), 'testnet', 'read', f.options), { intents: [], tasks: [] });
  assert.deepEqual(await listAgentSorobanInbox(f.store, address, 'public', 'read', f.options), { intents: [], tasks: [] });

  const entry = authorizationEntriesFromPlan(f.stored.authorizationPlan)[0];
  const preimage = xdr.HashIdPreimage.fromXdr(sorobanAuthorizationEntryPreimageXdr({
    entry, network: 'testnet', expirationLedger: read.intents[0].authorizers[0].expirationLedger,
  }), 'base64');
  const contributed = await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
    entryIndex: 0, signerAddress: address,
    signatureBase64: Buffer.from(f.signer.sign(hash(preimage.toXdr()))).toString('base64'),
  }, f.options);
  assert.equal(contributed.authorization.status, 'authorization_ready');
  const after = await listAgentSorobanInbox(f.store, address, 'testnet', 'read', f.options);
  assert.equal(after.tasks[0].signatureRequired, false);
  assert.equal(after.intents[0].status, 'authorization_ready');
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
  }, Keypair.random().publicKey()), 'route_execution');
  assert.equal(projectSorobanIntentViewerAction({
    ...base,
    status: 'authorization_ready',
  }, Keypair.random().publicKey(), true), 'waiting_execution');
  assert.equal(projectSorobanIntentViewerAction({
    ...base,
    status: 'authorization_ready',
  }, Keypair.random().publicKey(), true, true), 'execution_failed');
  assert.equal(projectSorobanIntentViewerAction({
    ...base,
    status: 'blocked',
    statusDetail: 'unsupported',
  }, Keypair.random().publicKey()), 'attention');
  assert.equal(projectSorobanIntentViewerAction({
    ...base,
    status: 'cancelled',
  }, Keypair.random().publicKey()), 'cancelled');
});

test('Integration-owned managed execution stays waiting for the Service instead of routing execution to the signer', async () => {
  const f = await fixture();
  await f.store.updateIntent({
    ...f.stored,
    integration: { version: 1, serviceId: 'fednetwork', serviceLabel: 'FedNetwork' },
    executionPolicy: {
      mode: 'multisigtools',
      executor: { address: f.creator.publicKey(), source: 'multisigtools_managed' },
    },
    authorizationPlan: { ...f.stored.authorizationPlan, authorizationEntriesXdr: [] },
  });
  const items = await listSorobanIntentInbox(f.store, f.creator.publicKey(), 'testnet', f.options);
  assert.equal(items[0]?.status, 'authorization_ready');
  assert.equal(items[0]?.viewerAction, 'waiting_execution');
});

test('cancelled Intent leaves the pending Inbox', async () => {
  const f = await fixture();
  await f.store.updateIntent({
    ...f.stored,
    cancellation: {
      version: 1,
      cancelledAt: '2026-09-14T10:01:00.000Z',
      authorizationPlanDigest: f.stored.authorizationPlan.authorizationPlanDigest,
      authorizationPlanRevision: 1,
      cancelledByAddress: f.creator.publicKey(),
    },
  });
  const cancelled = await listSorobanIntentInbox(f.store, f.creator.publicKey(), 'testnet', f.options);
  assert.deepEqual(cancelled, []);
  assert.deepEqual(await listAgentSorobanInbox(f.store, f.creator.publicKey(), 'testnet', 'write', f.options), { intents: [], tasks: [] });
});

test('confirmed external execution leaves the pending Inbox', async () => {
  const f = await fixture();
  const hash = 'ab'.repeat(32);
  const preparation: StoredSorobanIntentExecutionPreparation = {
    version: 1, transactionHash: hash, authorizationPlanDigest: f.stored.authorizationPlan.authorizationPlanDigest,
    authorizationPlanRevision: 1, executionSource: f.creator.publicKey(), transactionSequence: '9',
    validUntil: null, latestLedger: 101, effectsDigest: f.stored.authorizationPlan.effects.digest,
    effectsAccepted: false, preparedAt: '2026-09-14T10:01:00.000Z',
  };
  f.store.preparations.set(f.stored.id, [preparation]);
  f.store.observations.set(f.stored.id, [{
    version: 1, transactionHash: hash, authorizationPlanDigest: preparation.authorizationPlanDigest,
    authorizationPlanRevision: 1, executionSource: preparation.executionSource, ledger: 123, successful: true,
    observedAt: '2026-09-14T10:02:00.000Z',
  }]);

  const confirmed = await listSorobanIntentInbox(f.store, f.creator.publicKey(), 'testnet', f.options);
  assert.deepEqual(confirmed, []);
  assert.deepEqual(await listAgentSorobanInbox(f.store, f.creator.publicKey(), 'testnet', 'read', f.options), { intents: [], tasks: [] });
});
