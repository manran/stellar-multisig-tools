import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Address,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  hash,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import { sorobanAuthorizationPreimageXdr } from '../src/stellar/sorobanAuthorization.js';
import type { SignerPrincipalRef } from '../src/stellar/agentAccessTypes.js';
import type { StellarAccountSnapshot } from '../src/stellar/types.js';
import { createAgentSorobanPreparation } from './agentSorobanPreparationService.js';
import type { AgentCredentialStore, StoredAgentIdempotencyClaim, StoredSignerAgentCredential } from './agentCredentialStore.js';
import {
  contributeSorobanPreparation,
  createSorobanPreparation,
  freezeSorobanPreparation,
  getSorobanPreparation,
  listSorobanPreparationInbox,
  preparationViewerAction,
  refreshSorobanPreparationAuthorizationWindow,
} from './sorobanPreparationService.js';
import type {
  SorobanPreparationStore,
  StoredSorobanAuthorizationContribution,
  StoredSorobanPreparation,
  StoredSorobanPreparationFreeze,
} from './sorobanPreparationStore.js';
import type {
  SigningRequestStore,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from './requestStore.js';

class MemoryPreparationStore implements SorobanPreparationStore {
  records = new Map<string, StoredSorobanPreparation>();
  contributions = new Map<string, Map<string, StoredSorobanAuthorizationContribution>>();
  freezes = new Map<string, StoredSorobanPreparationFreeze>();

  async createPreparation(value: StoredSorobanPreparation) { this.records.set(value.id, value); }
  async updatePreparation(value: StoredSorobanPreparation) { this.records.set(value.id, value); }
  async getPreparation(id: string) { return this.records.get(id) ?? null; }
  async listPreparationsBySigner(network: 'public' | 'testnet', signerAddress: string) {
    return [...this.records.values()].filter((item) => item.network === network && item.discoverySignerKeys.includes(signerAddress));
  }
  async listContributions(id: string) { return [...(this.contributions.get(id)?.values() ?? [])]; }
  async putContribution(id: string, value: StoredSorobanAuthorizationContribution) {
    const items = this.contributions.get(id) ?? new Map<string, StoredSorobanAuthorizationContribution>();
    items.set(value.digest, value);
    this.contributions.set(id, items);
  }
  async getFreeze(id: string) { return this.freezes.get(id) ?? null; }
  async putFreeze(id: string, value: StoredSorobanPreparationFreeze) {
    if (!this.freezes.has(id)) this.freezes.set(id, value);
  }
}

class MemorySigningStore implements SigningRequestStore {
  requests = new Map<string, StoredSigningRequest>();
  contributions = new Map<string, Map<string, StoredSignatureContribution>>();
  submissions = new Map<string, StoredSubmissionResult>();

  async createRequest(value: StoredSigningRequest) {
    if (this.requests.has(value.id)) throw new Error('duplicate request');
    this.requests.set(value.id, value);
  }
  async getRequest(id: string) { return this.requests.get(id) ?? null; }
  async listContributions(id: string) { return [...(this.contributions.get(id)?.values() ?? [])]; }
  async putContribution(id: string, value: StoredSignatureContribution) {
    const items = this.contributions.get(id) ?? new Map<string, StoredSignatureContribution>();
    items.set(value.digest, value);
    this.contributions.set(id, items);
  }
  async getSubmission(id: string, transactionHash: string) {
    const value = this.submissions.get(id);
    return value?.transactionHash === transactionHash ? value : null;
  }
  async putSubmission(id: string, value: StoredSubmissionResult) { this.submissions.set(id, value); }
}

class MemoryAgentStore implements AgentCredentialStore {
  credentials = new Map<string, StoredSignerAgentCredential>();
  claims = new Map<string, StoredAgentIdempotencyClaim>();
  touched: string[] = [];

  async listCredentials(principal: SignerPrincipalRef) {
    return [...this.credentials.values()].filter((item) =>
      item.principal.network === principal.network && item.principal.address === principal.address);
  }
  async getCredential(id: string) { return this.credentials.get(id) ?? null; }
  async putCredential(value: StoredSignerAgentCredential) { this.credentials.set(value.credentialId, value); }
  async touchCredential(id: string) { this.touched.push(id); }
  async claimIdempotency(value: StoredAgentIdempotencyClaim) {
    const key = `${value.credentialId}:${value.idempotencyHash}`;
    const existing = this.claims.get(key);
    if (existing) return { claimed: false, claim: existing };
    this.claims.set(key, value);
    return { claimed: true, claim: value };
  }
  async releaseIdempotency(value: StoredAgentIdempotencyClaim) {
    this.claims.delete(`${value.credentialId}:${value.idempotencyHash}`);
  }
}

function snapshot(accountId: string, signers: Array<{ key: string; weight: number }>, medium: number): StellarAccountSnapshot {
  return {
    accountId,
    sequence: '1',
    subentryCount: signers.length,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium, high: medium },
    signers: signers.map((signer) => ({ ...signer, type: 'ed25519_public_key' })),
  };
}

function fixture() {
  const source = Keypair.random();
  const authorizer = Keypair.random();
  const signerA = Keypair.random();
  const signerB = Keypair.random();
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const args = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'approve_invoice',
    args: [nativeToScVal(authorizer.publicKey()), nativeToScVal('invoice-42')],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
    subInvocations: [],
  });
  const detached = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(authorizer.publicKey()).toScAddress(),
      nonce: xdr.Int64(42n),
      signatureExpirationLedger: 0,
      signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: invocation,
  });
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeInvokeContract(args), auth: [detached] }))
    .setSorobanData(new SorobanDataBuilder().build())
    .setTimeout(3600)
    .build();
  const authorizerAccount = snapshot(authorizer.publicKey(), [
    { key: signerA.publicKey(), weight: 1 },
    { key: signerB.publicKey(), weight: 1 },
  ], 2);
  const sourceAccount = snapshot(source.publicKey(), [{ key: source.publicKey(), weight: 1 }], 1);
  const accountLoader = async (accountId: string) => {
    if (accountId === authorizer.publicKey()) return authorizerAccount;
    if (accountId === source.publicKey()) return sourceAccount;
    throw new Error(`unexpected account ${accountId}`);
  };
  return { source, authorizer, signerA, signerB, transaction, accountLoader };
}

const networkParametersLoader = async () => ({
  ledgerSequence: 100,
  ledgerClosedAt: new Date(0).toISOString(),
  baseFeeInStroops: 100,
  baseReserveInStroops: 5_000_000,
});
const verifiedExecution = async () => ({ status: 'verified' as const });

function signAuthorization(xdrValue: string, entryIndex: number, expirationLedger: number, signer: Keypair) {
  const preimageXdr = sorobanAuthorizationPreimageXdr({
    envelopeXdr: xdrValue,
    network: 'testnet',
    entryIndex,
    expirationLedger,
  });
  const preimage = xdr.HashIdPreimage.fromXdr(preimageXdr, 'base64');
  return Buffer.from(signer.sign(hash(preimage.toXdr()))).toString('base64');
}

test('online Soroban preparation aggregates independent auth contributions then freezes into one immutable Proposal', async () => {
  const prepStore = new MemoryPreparationStore();
  const signingStore = new MemorySigningStore();
  const f = fixture();
  const id = 'A'.repeat(16);
  const actor = {
    type: 'agent' as const,
    id: 'agent-fresnica',
    label: 'Fresnica',
    principalAddress: f.signerA.publicKey(),
  };
  const created = await createSorobanPreparation(
    prepStore,
    { network: 'testnet', xdr: f.transaction.toXdr() },
    {
      idFactory: () => id,
      capabilityHash: 'f'.repeat(64),
      creatorAddress: f.signerA.publicKey(),
      creatorActor: actor,
      accountLoader: f.accountLoader,
      networkParametersLoader,
    },
  );
  assert.equal(created.status, 'awaiting_authorization');
  assert.equal(created.authorizers[0].signedWeight, 0);
  assert.deepEqual(prepStore.records.get(id)?.creatorActor, actor);
  assert.deepEqual(new Set(prepStore.records.get(id)?.discoverySignerKeys), new Set([
    f.signerA.publicKey(),
    f.signerB.publicKey(),
    f.source.publicKey(),
  ]));
  assert.equal(preparationViewerAction(f.signerA.publicKey(), created), 'authorize');
  assert.equal(preparationViewerAction(f.source.publicKey(), created), 'waiting');

  const target = created.authorizers[0];
  const signatureA = signAuthorization(created.preparedXdr, target.entryIndex, target.expirationLedger, f.signerA);
  const first = await contributeSorobanPreparation(prepStore, id, {
    entryIndex: target.entryIndex,
    signerAddress: f.signerA.publicKey(),
    signatureBase64: signatureA,
  }, { accountLoader: f.accountLoader, networkParametersLoader, contributionActor: actor });
  assert.equal(first.added, true);
  assert.deepEqual((await prepStore.listContributions(id))[0]?.submittedBy, actor);
  assert.equal(first.preparation.status, 'awaiting_authorization');
  assert.equal(first.preparation.authorizers[0].signedWeight, 1);
  assert.equal(preparationViewerAction(f.signerA.publicKey(), first.preparation), 'waiting');
  assert.equal(preparationViewerAction(f.signerB.publicKey(), first.preparation), 'authorize');

  const signerBInbox = await listSorobanPreparationInbox(prepStore, f.signerB.publicKey(), 'testnet', {
    accountLoader: f.accountLoader,
    networkParametersLoader,
  });
  assert.equal(signerBInbox.length, 1);
  assert.equal(signerBInbox[0].viewerAction, 'authorize');

  const signatureB = signAuthorization(created.preparedXdr, target.entryIndex, target.expirationLedger, f.signerB);
  const second = await contributeSorobanPreparation(prepStore, id, {
    entryIndex: target.entryIndex,
    signerAddress: f.signerB.publicKey(),
    signatureBase64: signatureB,
  }, { accountLoader: f.accountLoader, networkParametersLoader });
  assert.equal(second.preparation.status, 'ready_to_freeze');
  assert.equal(second.preparation.authorizers[0].signedWeight, 2);
  assert.equal(preparationViewerAction(f.source.publicKey(), second.preparation), 'freeze');

  const sourceInbox = await listSorobanPreparationInbox(prepStore, f.source.publicKey(), 'testnet', {
    accountLoader: f.accountLoader,
    networkParametersLoader,
  });
  assert.equal(sourceInbox.length, 1);
  assert.equal(sourceInbox[0].viewerAction, 'freeze');

  const preparedForProposal = TransactionBuilder.fromXdr(second.preparation.preparedXdr, Networks.TESTNET);
  if (preparedForProposal instanceof FeeBumpTransaction) {
    throw new Error('Test fixture unexpectedly produced a fee-bump transaction.');
  }
  const reassembledXdr = TransactionBuilder.cloneFrom(
    preparedForProposal,
    {
      networkPassphrase: Networks.TESTNET,
      fee: '600',
      sorobanData: new SorobanDataBuilder().setResources(2_000_000, 0, 0).setResourceFee('500').build(),
    },
  ).build().toXdr();
  let preparationInput: string | null = null;
  const proposal = await freezeSorobanPreparation(prepStore, signingStore, id, {
    actorAddress: f.source.publicKey(),
    actor: { ...actor, principalAddress: f.source.publicKey() },
    accountLoader: f.accountLoader,
    networkParametersLoader,
    sorobanExecutionVerifier: verifiedExecution,
    sorobanTransactionPreparer: async ({ envelopeXdr, network }) => {
      preparationInput = envelopeXdr;
      assert.equal(network, 'testnet');
      return { endpointUrl: 'https://rpc.example.test/', latestLedger: 100, assembledXdr: reassembledXdr };
    },
  });
  assert.equal(proposal.id, id);
  assert.equal(proposal.status, 'awaiting_signatures');
  assert.equal(signingStore.requests.get(id)?.capabilityHash, 'f'.repeat(64));
  assert.equal(signingStore.requests.get(id)?.creatorAddress, f.source.publicKey());
  assert.equal(signingStore.requests.get(id)?.creatorActor?.id, actor.id);
  assert.equal(preparationInput, second.preparation.preparedXdr);
  assert.equal(signingStore.requests.get(id)?.baseXdr, reassembledXdr);
  const frozen = await getSorobanPreparation(prepStore, id, { accountLoader: f.accountLoader, networkParametersLoader });
  assert.equal(frozen.status, 'frozen');
  assert.equal(frozen.proposalId, id);
});


test('refreshes an expired Soroban authorization window only before collaboration starts', async () => {
  const prepStore = new MemoryPreparationStore();
  const f = fixture();
  const id = 'B'.repeat(16);
  const created = await createSorobanPreparation(
    prepStore,
    { network: 'testnet', xdr: f.transaction.toXdr() },
    {
      idFactory: () => id,
      capabilityHash: 'a'.repeat(64),
      creatorAddress: f.signerA.publicKey(),
      accountLoader: f.accountLoader,
      networkParametersLoader: async () => ({
        ledgerSequence: 1000,
        ledgerClosedAt: new Date(0).toISOString(),
        baseFeeInStroops: 100,
        baseReserveInStroops: 5_000_000,
      }),
    },
  );
  const before = prepStore.records.get(id)?.baseXdr;
  const refreshed = await refreshSorobanPreparationAuthorizationWindow(prepStore, id, {
    now: new Date('2026-01-01T00:00:00Z'),
    accountLoader: f.accountLoader,
    networkParametersLoader: async () => ({
      ledgerSequence: 2000,
      ledgerClosedAt: new Date(0).toISOString(),
      baseFeeInStroops: 100,
      baseReserveInStroops: 5_000_000,
    }),
  });
  assert.equal(refreshed.status, 'awaiting_authorization');
  assert.notEqual(refreshed.expiresAt, created.expiresAt);
  assert.ok(prepStore.records.get(id)?.baseXdr);
  assert.equal(typeof before, 'string');

});

test('Agent creates one attributable Soroban authorization preparation idempotently', async () => {
  const prepStore = new MemoryPreparationStore();
  const agentStore = new MemoryAgentStore();
  const f = fixture();
  const credential: StoredSignerAgentCredential = {
    version: 1,
    credentialId: 'agent-soroban',
    principal: { type: 'signer', network: 'testnet', address: f.signerA.publicKey() },
    label: 'Fresnica',
    access: 'write',
    prefix: 'msa_agent',
    secretHash: 'a'.repeat(64),
    createdAt: new Date(0).toISOString(),
    createdBy: f.signerA.publicKey(),
  };
  await agentStore.putCredential(credential);
  const input = {
    network: 'testnet' as const,
    xdr: f.transaction.toXdr(),
    idempotencyKey: 'fresnica-contract-auth-1',
  };
  const options = {
    idFactory: () => 'C'.repeat(16),
    accountLoader: f.accountLoader,
    networkParametersLoader,
  };
  const first = await createAgentSorobanPreparation(
    agentStore,
    prepStore,
    credential,
    input,
    options,
  );
  const replay = await createAgentSorobanPreparation(
    agentStore,
    prepStore,
    credential,
    input,
    options,
  );

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.preparation.id, first.preparation.id);
  assert.equal(prepStore.records.size, 1);
  assert.deepEqual(prepStore.records.get(first.preparation.id)?.creatorActor, {
    type: 'agent',
    id: credential.credentialId,
    label: credential.label,
    principalAddress: credential.principal.address,
  });
  assert.deepEqual(agentStore.touched, [credential.credentialId, credential.credentialId]);

  await assert.rejects(
    createAgentSorobanPreparation(
      agentStore,
      prepStore,
      credential,
      { ...input, xdr: `${input.xdr}different` },
      options,
    ),
    /Idempotency key is already bound/,
  );
});
