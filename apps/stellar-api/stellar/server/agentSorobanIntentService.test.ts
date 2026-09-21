import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Address,
  Contract,
  Keypair,
  SorobanDataBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import { Spec } from '@stellar/stellar-sdk/contract';
import type { SignerPrincipalRef } from '../../../../src/stellar/agentAccessTypes.js';
import { describeContractSpec } from '../../../../src/stellar/contractSpec.js';
import { materializeSorobanIntent } from '../../../../src/stellar/sorobanIntent.js';
import { emptySorobanEffectsSnapshot } from '../../../../src/stellar/sorobanEffects.js';
import type {
  AgentCredentialStore,
  StoredAgentIdempotencyClaim,
  StoredSignerAgentCredential,
} from './agentCredentialStore.js';
import { createAgentSorobanIntent } from './agentSorobanIntentService.js';
import { buildContractIntent } from './contractIntentService.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

const CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
class MemoryAgentStore implements AgentCredentialStore {
  credentials = new Map<string, StoredSignerAgentCredential>();
  claims = new Map<string, StoredAgentIdempotencyClaim>();
  async listCredentials(principal: SignerPrincipalRef) {
    return [...this.credentials.values()].filter((item) =>
      item.principal.network === principal.network && item.principal.address === principal.address);
  }
  async getCredential(id: string) { return this.credentials.get(id) ?? null; }
  async putCredential(value: StoredSignerAgentCredential) { this.credentials.set(value.credentialId, value); }
  async touchCredential(id: string, usedAt: string) {
    const value = this.credentials.get(id);
    if (value) this.credentials.set(id, { ...value, lastUsedAt: usedAt });
  }
  async claimIdempotency(claim: StoredAgentIdempotencyClaim) {
    const key = `${claim.credentialId}:${claim.idempotencyHash}`;
    const existing = this.claims.get(key);
    if (existing) return { claimed: false, claim: existing };
    this.claims.set(key, claim);
    return { claimed: true, claim };
  }
  async releaseIdempotency(claim: StoredAgentIdempotencyClaim) {
    this.claims.delete(`${claim.credentialId}:${claim.idempotencyHash}`);
  }
}
class MemoryIntentStore implements SorobanIntentStore {
  values = new Map<string, StoredSorobanIntent>();
  async createIntent(value: StoredSorobanIntent) {
    if (this.values.has(value.id)) throw new Error('duplicate intent');
    this.values.set(value.id, value);
  }
  async getIntent(id: string) { return this.values.get(id) ?? null; }
  async updateIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async listContributions() { return []; }
  async putContribution() {}
}

function loadedInterface() {
  const entry = xdr.ScSpecEntry.scSpecEntryFunctionV0(new xdr.ScSpecFunctionV0({
    name: 'reserve',
    inputs: [new xdr.ScSpecFunctionInputV0({
      name: 'wallet',
      type: xdr.ScSpecTypeDef.scSpecTypeString(),
      doc: '',
    })],
    outputs: [],
    doc: '',
  }));
  const spec = new Spec([entry]);
  return { spec, methods: describeContractSpec(spec) };
}

function credential(access: 'read' | 'write' | 'sign' = 'write') {
  const address = Keypair.random().publicKey();
  return {
    version: 1 as const,
    credentialId: 'agent-1',
    principal: { type: 'signer' as const, network: 'testnet' as const, address },
    label: 'Intent Agent',
    access,
    prefix: 'msa_agent-1',
    secretHash: '00'.repeat(32),
    createdAt: '2026-09-14T00:00:00.000Z',
    createdBy: address,
  } satisfies StoredSignerAgentCredential;
}
async function serviceOptions(sourceBound = false) {
  const planningSource = Keypair.random();
  const authorizer = Keypair.random();
  const built = await buildContractIntent({
    network: 'testnet',
    contractId: CONTRACT_ID,
    method: 'reserve',
    arguments: { wallet: 'fresnica' },
  }, { interfaceLoader: async () => loadedInterface() });
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: new Contract(CONTRACT_ID).address().toScAddress(),
    functionName: 'reserve',
    args: [nativeToScVal('fresnica')],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
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
  const assembled = materializeSorobanIntent({
    intent: built.intent,
    sourceAccount: planningSource.publicKey(),
    sourceSequence: '7',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [auth],
    sorobanData: new SorobanDataBuilder().build(),
  });
  return {
    planningSource: planningSource.publicKey(),
    contractDependencies: { interfaceLoader: async () => loadedInterface() },
    planningDependencies: {
      accountLoader: async (address: string) => address === authorizer.publicKey()
        ? ({
            accountId: authorizer.publicKey(), sequence: '1', subentryCount: 0,
            numSponsoring: 0, numSponsored: 0,
            thresholds: { low: 1, medium: 1, high: 1 },
            signers: [{ key: authorizer.publicKey(), type: 'ed25519_public_key' as const, weight: 1 }],
          } as never)
        : ({ accountId: planningSource.publicKey(), sequence: '7' } as never),
      networkParametersLoader: async () => ({ baseFeeInStroops: 100 } as never),
      simulator: async () => ({ assembledXdr: assembled.toXDR(), latestLedger: 100, effects: emptySorobanEffectsSnapshot() } as never),
    },
  };
}

const createInput = {
  network: 'testnet' as const,
  contractId: CONTRACT_ID,
  method: 'reserve',
  arguments: { wallet: 'fresnica' },
  idempotencyKey: 'intent-42',
  privateNote: 'Treasury reserve',
  externalReference: 'job-42',
};
test('Write Agent creates a source-free Intent with detached AuthorizationPlan and off-chain context', async () => {
  const agents = new MemoryAgentStore();
  const intents = new MemoryIntentStore();
  const key = credential('write');
  agents.credentials.set(key.credentialId, key);
  const result = await createAgentSorobanIntent(
    agents,
    intents,
    key,
    createInput,
    { ...(await serviceOptions()), idFactory: () => 'A'.repeat(16), now: new Date('2026-09-14T01:00:00Z') },
  );
  assert.equal(result.replayed, false);
  assert.equal(result.intent.id, 'A'.repeat(16));
  assert.equal(result.intent.authorizationPlan?.executionBinding, 'detached');
  assert.equal(result.intent.privateContext?.initialPrivateNote?.text, 'Treasury reserve');
  assert.equal(result.intent.privateContext?.externalReference, 'job-42');
  assert.equal('baseXdr' in result.intent, false);
  assert.equal('transactionSource' in result.intent, false);
});
test('Agent Intent creation replays the same durable resource through existing idempotency claims', async () => {
  const agents = new MemoryAgentStore();
  const intents = new MemoryIntentStore();
  const key = credential('write');
  agents.credentials.set(key.credentialId, key);
  const options = { ...(await serviceOptions()), idFactory: () => 'B'.repeat(16) };
  const first = await createAgentSorobanIntent(agents, intents, key, createInput, options);
  const second = await createAgentSorobanIntent(agents, intents, key, createInput, options);
  assert.equal(first.intent.id, 'B'.repeat(16));
  assert.equal(second.intent.id, first.intent.id);
  assert.equal(second.replayed, true);
  assert.equal(intents.values.size, 1);
});

test('SOURCE_ACCOUNT planning is rejected instead of binding Intent to a transaction source', async () => {
  const agents = new MemoryAgentStore();
  const intents = new MemoryIntentStore();
  const key = credential('write');
  agents.credentials.set(key.credentialId, key);
  const options = { ...(await serviceOptions(true)), idFactory: () => 'C'.repeat(16) };
  await assert.rejects(
    () => createAgentSorobanIntent(
      agents,
      intents,
      key,
      { ...createInput, idempotencyKey: 'source-bound' },
      options,
    ),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'source_account_auth_unsupported',
  );
  assert.equal(intents.values.size, 0);
  assert.equal(agents.claims.size, 0);
});
test('Intent creation requires Write access and Principal network match', async () => {
  const agents = new MemoryAgentStore();
  const intents = new MemoryIntentStore();
  const readKey = credential('read');
  agents.credentials.set(readKey.credentialId, readKey);
  const options = await serviceOptions();
  await assert.rejects(
    () => createAgentSorobanIntent(agents, intents, readKey, createInput, options),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'agent_access_denied',
  );

  const wrongNetwork = {
    ...credential('write'),
    credentialId: 'agent-2',
    principal: { type: 'signer' as const, network: 'public' as const, address: Keypair.random().publicKey() },
  } satisfies StoredSignerAgentCredential;
  agents.credentials.set(wrongNetwork.credentialId, wrongNetwork);
  await assert.rejects(
    () => createAgentSorobanIntent(agents, intents, wrongNetwork, createInput, options),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'principal_network_mismatch',
  );
});

test('reusing an idempotency key for a different Intent is rejected', async () => {
  const agents = new MemoryAgentStore();
  const intents = new MemoryIntentStore();
  const key = credential('write');
  agents.credentials.set(key.credentialId, key);
  const options = { ...(await serviceOptions()), idFactory: () => 'D'.repeat(16) };
  await createAgentSorobanIntent(agents, intents, key, createInput, options);
  await assert.rejects(
    () => createAgentSorobanIntent(agents, intents, key, {
      ...createInput,
      arguments: { wallet: 'different' },
    }, options),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'idempotency_conflict',
  );
});
