import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  hash,
  Networks,
  Operation,
  SorobanDataBuilder,
  TimeoutInfinite,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import {
  contributeSigningRequest,
  createSigningRequest,
  getSigningRequest,
  getSigningRequestForStoredRequest,
  SigningRequestServiceError,
  submitSigningRequest,
} from './requestService.js';
import type {
  SigningRequestStore,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from './requestStore.js';
import type { StellarAccountSnapshot } from '../../../../src/stellar/types.js';
import type { SorobanEffectsSnapshot } from '../../../../src/stellar/sorobanEffects.js';
import type { ActivityFactEvent } from '../../../../src/stellar/activityTypes.js';
import {
  mergeSorobanGAccountSignature,
  sorobanAuthorizationPreimageXdr,
} from '../../../../src/stellar/sorobanAuthorization.js';

class MemoryStore implements SigningRequestStore {
  requests = new Map<string, StoredSigningRequest>();
  contributions = new Map<string, Map<string, StoredSignatureContribution>>();
  submissions = new Map<string, StoredSubmissionResult>();
  activityEvents = new Map<string, ActivityFactEvent[]>();

  async createRequest(request: StoredSigningRequest) {
    if (this.requests.has(request.id)) throw new Error('duplicate request');
    this.requests.set(request.id, request);
  }

  async getRequest(id: string) {
    return this.requests.get(id) ?? null;
  }

  async listContributions(id: string) {
    return [...(this.contributions.get(id)?.values() ?? [])];
  }

  async putContribution(id: string, contribution: StoredSignatureContribution) {
    const entries = this.contributions.get(id) ?? new Map<string, StoredSignatureContribution>();
    entries.set(contribution.digest, contribution);
    this.contributions.set(id, entries);
  }

  async getSubmission(id: string, transactionHash: string) {
    const submission = this.submissions.get(id);
    return submission?.transactionHash === transactionHash ? submission : null;
  }

  async putSubmission(id: string, submission: StoredSubmissionResult) {
    this.submissions.set(id, submission);
  }

  async listActivityEvents(id: string) {
    return this.activityEvents.get(id) ?? [];
  }

  async putActivityEvent(id: string, event: ActivityFactEvent) {
    const events = this.activityEvents.get(id) ?? [];
    this.activityEvents.set(id, [...events.filter((item) => item.eventId !== event.eventId), event]);
  }
}

function paymentTransaction() {
  const source = Keypair.random();
  const second = Keypair.random();
  const account = new Account(source.publicKey(), '1');
  const transaction = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: '1',
    }))
    .setTimeout(TimeoutInfinite)
    .build();
  return { source, second, transaction };
}

function sorobanTransaction({ prepared = false, detached = false } = {}) {
  const source = Keypair.random();
  const second = Keypair.random();
  const authorizer = Keypair.random();
  const authorizerSignerA = Keypair.random();
  const authorizerSignerB = Keypair.random();
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'approve_proposal',
    args: [nativeToScVal('proposal')],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });
  const auth = [new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: invocation,
  })];
  if (detached) {
    auth.push(new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
        new xdr.SorobanAddressCredentials({
          address: new Address(authorizer.publicKey()).toScAddress(),
          nonce: xdr.Int64(42n),
          signatureExpirationLedger: 0,
          signature: xdr.ScVal.scvVec([]),
        }),
      ),
      rootInvocation: invocation,
    }));
  }
  let builder = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
      auth,
    }))
    .setTimeout(TimeoutInfinite);
  if (prepared) builder = builder.setSorobanData(new SorobanDataBuilder().build());
  const transaction = builder.build();
  return { source, second, authorizer, authorizerSignerA, authorizerSignerB, transaction };
}

function contractAccountSorobanTransaction({ signed = false, expirationLedger = 500 } = {}) {
  const source = Keypair.random();
  const second = Keypair.random();
  const accountContract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: accountContract.address().toScAddress(),
    functionName: 'approve_proposal',
    args: [nativeToScVal('proposal')],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });
  const authorization = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: accountContract.address().toScAddress(),
        nonce: xdr.Int64(91n),
        signatureExpirationLedger: expirationLedger,
        signature: signed ? xdr.ScVal.scvBytes(Buffer.alloc(64, 7)) : xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: invocation,
  });
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
      auth: [authorization],
    }))
    .setSorobanData(new SorobanDataBuilder().build())
    .setTimeout(TimeoutInfinite)
    .build();
  return { source, second, accountContract, transaction };
}

const networkParametersLoader = async () => ({
  ledgerSequence: 100,
  ledgerClosedAt: new Date(0).toISOString(),
  baseFeeInStroops: 100,
  baseReserveInStroops: 5_000_000,
});

const verifiedSorobanExecution = async () => ({ status: 'verified' as const });

function testEffectsSnapshot(value: bigint, digest: string, structureDigest = 'stable-structure'): SorobanEffectsSnapshot {
  return {
    version: 1,
    digest,
    structureDigest,
    stateChangeCount: 0,
    eventCount: 0,
    stateChanges: [],
    events: [],
    numericEffects: [{ key: 'effect:quote', label: 'Quote amount', value: value.toString() }],
    truncated: false,
  };
}

async function withContractAdapterConfig<T>(
  contractAddress: string,
  ownerAddress: string,
  run: () => Promise<T> | T,
): Promise<T> {
  const contractKey = 'STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT';
  const ownerKey = 'STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_OWNER';
  const previousContract = process.env[contractKey];
  const previousOwner = process.env[ownerKey];
  process.env[contractKey] = contractAddress;
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

function detachedAuthorizerSnapshot(
  accountId: string,
  signerA: Keypair,
  signerB: Keypair,
): StellarAccountSnapshot {
  return {
    accountId,
    sequence: '1',
    subentryCount: 2,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [
      { key: signerA.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: signerB.publicKey(), type: 'ed25519_public_key', weight: 1 },
    ],
  };
}

async function signDetachedSorobanEntry(
  envelopeXdr: string,
  signer: Keypair,
  expirationLedger = 500,
) {
  const preimageXdr = sorobanAuthorizationPreimageXdr({
    envelopeXdr,
    network: 'testnet',
    entryIndex: 1,
    expirationLedger,
  });
  const preimage = xdr.HashIdPreimage.fromXdr(preimageXdr, 'base64');
  return mergeSorobanGAccountSignature({
    envelopeXdr,
    network: 'testnet',
    entryIndex: 1,
    signerPublicKey: signer.publicKey(),
    signatureBase64: Buffer.from(signer.sign(hash(preimage.toXdr()))).toString('base64'),
    expirationLedger,
  });
}

function accountSnapshot(
  source: Keypair,
  second: Keypair,
  medium = 2,
  sequence = '1',
): StellarAccountSnapshot {
  return {
    accountId: source.publicKey(),
    sequence,
    subentryCount: 1,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium, high: 2 },
    signers: [
      { key: source.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: second.publicKey(), type: 'ed25519_public_key', weight: 1 },
    ],
  };
}

test('creates a capability request and advances from waiting to ready', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const snapshot = accountSnapshot(source, second, 2);
  const accountLoader = async () => snapshot;
  const id = 'A'.repeat(16);
  const created = await createSigningRequest(
    store,
    { network: 'testnet', xdr: transaction.toXdr() },
    { accountLoader, idFactory: () => id, capabilityHash: 'f'.repeat(64) },
  );
  assert.equal(created.id, id);
  assert.equal(store.requests.get(id)?.capabilityHash, 'f'.repeat(64));
  assert.equal(created.signatureCount, 0);
  assert.equal(created.status, 'awaiting_signatures');
  assert.equal(created.statusReason, 'signatures_required');

  const sourceCopy = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  sourceCopy.sign(source);
  const first = await contributeSigningRequest(store, id, sourceCopy.toXdr(), { accountLoader });
  assert.equal(first.addedSignatureCount, 1);
  assert.equal(first.request.signatureCount, 1);
  assert.equal(first.request.status, 'awaiting_signatures');
  assert.deepEqual(first.acceptedSignerAddresses, [source.publicKey()]);
  assert.ok(first.contributionDigest);
  const firstStored = (await store.listContributions(id))[0];
  assert.equal(firstStored.version, 2);
  assert.equal(firstStored.provenance, 'in_product_contribution');
  assert.equal(firstStored.acceptedSignatures?.[0]?.signerKey, source.publicKey());
  assert.match(firstStored.acceptedSignatures?.[0]?.signatureHint ?? '', /^[0-9a-f]{8}$/);
  assert.match(firstStored.acceptedSignatures?.[0]?.signatureDigest ?? '', /^[0-9a-f]{64}$/);

  const secondCopy = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  secondCopy.sign(second);
  const final = await contributeSigningRequest(store, id, secondCopy.toXdr(), { accountLoader });
  assert.equal(final.addedSignatureCount, 1);
  assert.equal(final.request.signatureCount, 2);
  assert.equal(final.request.status, 'ready');
  assert.equal(final.request.statusReason, 'authorization_complete');

  const reloaded = await getSigningRequest(store, id, { accountLoader });
  assert.equal(reloaded.signatureCount, 2);
  assert.equal(reloaded.contributionCount, 2);
  assert.equal(reloaded.status, 'ready');
});

test('rejects an unassembled Soroban transaction before Request freeze', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = sorobanTransaction();
  let policyLookups = 0;
  const accountLoader = async () => {
    policyLookups += 1;
    return accountSnapshot(source, second, 2);
  };

  await assert.rejects(
    createSigningRequest(
      store,
      { network: 'testnet', xdr: transaction.toXdr() },
      { accountLoader, networkParametersLoader, idFactory: () => 'S'.repeat(16) },
    ),
    (cause: unknown) => cause instanceof SigningRequestServiceError
      && cause.status === 400
      && cause.code === 'soroban_authorization_not_prepared',
  );
  assert.equal(store.requests.size, 0);
  assert.equal(policyLookups, 0);
});

test('prepared Soroban Request freeze requires server-side enforce simulation proof', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = sorobanTransaction({ prepared: true });
  const accountLoader = async () => accountSnapshot(source, second, 2);
  await assert.rejects(
    createSigningRequest(
      store,
      { network: 'testnet', xdr: transaction.toXdr() },
      {
        accountLoader,
        networkParametersLoader,
        sorobanExecutionVerifier: async () => ({
          status: 'invalid',
          detail: 'Contract execution rejected the frozen authorization topology.',
        }),
        idFactory: () => 'W'.repeat(16),
      },
    ),
    (cause: unknown) => cause instanceof SigningRequestServiceError
      && cause.code === 'soroban_execution_failed',
  );
  assert.equal(store.requests.size, 0);
});

test('Soroban Request freeze retains verified Intent origin and rejects effects drift after preparation', async () => {
  const effects = testEffectsSnapshot(100n, 'prepared-effects');
  const { source, second, transaction } = sorobanTransaction({ prepared: true });
  const origin = {
    version: 1 as const,
    intentId: 'R'.repeat(16),
    authorizationPlanDigest: 'plan-2',
    authorizationPlanRevision: 2,
    executionPreparedAt: '2026-09-16T01:01:00.000Z',
    effectsDigest: effects.digest,
  };
  const store = new MemoryStore();
  const created = await createSigningRequest(
    store,
    { network: 'testnet', xdr: transaction.toXdr() },
    {
      accountLoader: async () => accountSnapshot(source, second, 2),
      networkParametersLoader,
      sorobanExecutionVerifier: async () => ({ status: 'verified' as const, effects }),
      sorobanOrigin: origin,
      executionPolicy: { mode: 'multisigtools' },
      idFactory: () => 'Y'.repeat(16),
    },
  );
  assert.deepEqual(created.sorobanOrigin, origin);
  assert.equal(created.execution?.mode, 'multisigtools');
  assert.deepEqual(store.requests.get(created.id)?.sorobanOrigin, origin);

  await assert.rejects(
    createSigningRequest(
      new MemoryStore(),
      { network: 'testnet', xdr: transaction.toXDR() },
      {
        accountLoader: async () => accountSnapshot(source, second, 2),
        networkParametersLoader,
        sorobanExecutionVerifier: async () => ({ status: 'verified' as const, effects: testEffectsSnapshot(101n, 'changed-effects') }),
        sorobanOrigin: origin,
        idFactory: () => 'Z'.repeat(16),
      },
    ),
    (cause: unknown) => cause instanceof SigningRequestServiceError && cause.code === 'soroban_origin_effects_changed',
  );
});

test('contract-account Soroban authorization stays read-only at Request freeze', async () => {
  const store = new MemoryStore();
  const { transaction } = contractAccountSorobanTransaction();
  let accountLookups = 0;
  let executionVerifications = 0;
  await assert.rejects(
    createSigningRequest(
      store,
      { network: 'testnet', xdr: transaction.toXdr() },
      {
        accountLoader: async () => {
          accountLookups += 1;
          throw new Error('C-account authorization must not use Horizon signer policy.');
        },
        networkParametersLoader,
        sorobanExecutionVerifier: async () => {
          executionVerifications += 1;
          return { status: 'verified' as const };
        },
        idFactory: () => 'C'.repeat(16),
      },
    ),
    (cause: unknown) => cause instanceof SigningRequestServiceError
      && cause.code === 'soroban_authorization_unsupported'
      && /no explicitly configured authorization adapter.*read-only/i.test(cause.message),
  );
  assert.equal(store.requests.size, 0);
  assert.equal(accountLookups, 0);
  assert.equal(executionVerifications, 0);
});

test('configured contract-account credential reaches Proposal only after server enforce verification', async () => {
  const store = new MemoryStore();
  const { source, second, accountContract, transaction } = contractAccountSorobanTransaction({ signed: true });
  const owner = Keypair.random();
  await withContractAdapterConfig(accountContract.address().toString(), owner.publicKey(), async () => {
    let executionVerifications = 0;
    const created = await createSigningRequest(
      store,
      { network: 'testnet', xdr: transaction.toXdr() },
      {
        accountLoader: async (accountId) => {
          assert.equal(accountId, source.publicKey());
          return accountSnapshot(source, second, 2);
        },
        networkParametersLoader,
        sorobanExecutionVerifier: async () => {
          executionVerifications += 1;
          return { status: 'verified' as const };
        },
        idFactory: () => 'K'.repeat(16),
      },
    );
    assert.equal(created.status, 'awaiting_signatures');
    assert.equal(executionVerifications, 1);
    assert.equal(store.requests.size, 1);

    const sourceCopy = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
    sourceCopy.sign(source);
    const first = await contributeSigningRequest(store, created.id, sourceCopy.toXdr(), {
      accountLoader: async () => accountSnapshot(source, second, 2),
      networkParametersLoader,
    });
    assert.equal(first.request.status, 'awaiting_signatures');
    assert.equal(first.request.statusReason, 'signatures_required');

    const secondCopy = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
    secondCopy.sign(second);
    const final = await contributeSigningRequest(store, created.id, secondCopy.toXdr(), {
      accountLoader: async () => accountSnapshot(source, second, 2),
      networkParametersLoader,
    });
    assert.equal(final.request.status, 'ready');
    assert.equal(final.request.statusReason, 'authorization_complete');
    assert.equal(executionVerifications, 1);
  });
});

test('configured contract-account credential still fails closed when server enforcement rejects it', async () => {
  const store = new MemoryStore();
  const { source, second, accountContract, transaction } = contractAccountSorobanTransaction({ signed: true });
  const owner = Keypair.random();
  await withContractAdapterConfig(accountContract.address().toString(), owner.publicKey(), async () => {
    await assert.rejects(
      createSigningRequest(
        store,
        { network: 'testnet', xdr: transaction.toXdr() },
        {
          accountLoader: async () => accountSnapshot(source, second, 1),
          networkParametersLoader,
          sorobanExecutionVerifier: async () => ({
            status: 'invalid' as const,
            detail: 'The configured account contract rejected this credential.',
          }),
          idFactory: () => 'J'.repeat(16),
        },
      ),
      (cause: unknown) => cause instanceof SigningRequestServiceError
        && cause.code === 'soroban_execution_failed',
    );
    assert.equal(store.requests.size, 0);
  });
});

test('source-account Soroban authorization enters the ordinary envelope-signature Proposal after assembly', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = sorobanTransaction({ prepared: true });
  const accountLoader = async () => accountSnapshot(source, second, 2);
  let executionVerifications = 0;
  const sorobanExecutionVerifier = async () => {
    executionVerifications += 1;
    return { status: 'verified' as const };
  };
  const id = 'Q'.repeat(16);
  const created = await createSigningRequest(
    store,
    { network: 'testnet', xdr: transaction.toXdr() },
    { accountLoader, networkParametersLoader, sorobanExecutionVerifier, idFactory: () => id },
  );
  assert.equal(created.status, 'awaiting_signatures');

  const sourceCopy = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  sourceCopy.sign(source);
  const first = await contributeSigningRequest(store, id, sourceCopy.toXdr(), {
    accountLoader,
    networkParametersLoader,
  });
  assert.equal(first.request.status, 'awaiting_signatures');

  const secondCopy = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  secondCopy.sign(second);
  const final = await contributeSigningRequest(store, id, secondCopy.toXdr(), {
    accountLoader,
    networkParametersLoader,
  });
  assert.equal(final.request.status, 'ready');
  assert.equal(final.request.statusReason, 'authorization_complete');
  assert.equal(executionVerifications, 1);

  const submitted = await submitSigningRequest(store, id, {
    accountLoader,
    networkParametersLoader,
    sorobanExecutionVerifier,
    transactionLoader: async () => null,
    transactionSubmitter: async () => ({
      hash: final.request.transactionHash,
      ledger: 12345,
      successful: true,
      createdAt: '2026-09-08T00:00:00Z',
    }),
  });
  assert.equal(submitted.status, 'submitted');
  assert.equal(executionVerifications, 2);
});

test('Soroban Proposal requires exact digest acceptance for critical numeric effects drift', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = sorobanTransaction({ prepared: true });
  const accountLoader = async () => accountSnapshot(source, second, 2);
  const baseline = testEffectsSnapshot(100n, 'effects-100');
  const current = testEffectsSnapshot(90n, 'effects-90');
  let verificationCount = 0;
  const verifier = async () => ({
    status: 'verified' as const,
    effects: verificationCount++ === 0 ? baseline : current,
  });
  const id = 'E'.repeat(16);
  await createSigningRequest(store, { network: 'testnet', xdr: transaction.toXdr() }, {
    accountLoader, networkParametersLoader, sorobanExecutionVerifier: verifier, idFactory: () => id,
  });
  const first = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  first.sign(source);
  await contributeSigningRequest(store, id, first.toXdr(), { accountLoader, networkParametersLoader });
  const secondSigned = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  secondSigned.sign(second);
  const ready = await contributeSigningRequest(store, id, secondSigned.toXdr(), { accountLoader, networkParametersLoader });
  let submits = 0;
  const submitOptions = {
    accountLoader,
    networkParametersLoader,
    sorobanExecutionVerifier: verifier,
    transactionLoader: async () => null,
    transactionSubmitter: async () => {
      submits += 1;
      return { hash: ready.request.transactionHash, ledger: 12345, successful: true, createdAt: '2026-09-15T00:00:00Z' };
    },
  };
  await assert.rejects(
    submitSigningRequest(store, id, submitOptions),
    (cause: unknown) => cause instanceof SigningRequestServiceError
      && cause.code === 'soroban_effects_review_required'
      && (cause.details as { effectsDiff?: { maxChangeBasisPoints?: number } } | undefined)?.effectsDiff?.maxChangeBasisPoints === 1000,
  );
  assert.equal(submits, 0);
  const submitted = await submitSigningRequest(store, id, { ...submitOptions, acceptedEffectsDigest: current.digest });
  assert.equal(submitted.status, 'submitted');
  assert.equal(submits, 1);
});


test('Soroban Proposal structural effects change cannot be accepted by digest', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = sorobanTransaction({ prepared: true });
  const accountLoader = async () => accountSnapshot(source, second, 2);
  const baseline = testEffectsSnapshot(100n, 'effects-before', 'structure-before');
  const current = testEffectsSnapshot(100n, 'effects-after', 'structure-after');
  let verificationCount = 0;
  const verifier = async () => ({
    status: 'verified' as const,
    effects: verificationCount++ === 0 ? baseline : current,
  });
  const id = 'F'.repeat(16);
  await createSigningRequest(store, { network: 'testnet', xdr: transaction.toXdr() }, {
    accountLoader, networkParametersLoader, sorobanExecutionVerifier: verifier, idFactory: () => id,
  });
  const first = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  first.sign(source);
  await contributeSigningRequest(store, id, first.toXdr(), { accountLoader, networkParametersLoader });
  const secondSigned = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  secondSigned.sign(second);
  await contributeSigningRequest(store, id, secondSigned.toXdr(), { accountLoader, networkParametersLoader });
  let submits = 0;
  await assert.rejects(
    submitSigningRequest(store, id, {
      accountLoader,
      networkParametersLoader,
      sorobanExecutionVerifier: verifier,
      acceptedEffectsDigest: current.digest,
      transactionLoader: async () => null,
      transactionSubmitter: async () => {
        submits += 1;
        throw new Error('must not broadcast');
      },
    }),
    (cause: unknown) => cause instanceof SigningRequestServiceError
      && cause.code === 'soroban_effects_reauthorization_required'
      && (cause.details as { effectsDiff?: { requiresReauthorization?: boolean } } | undefined)?.effectsDiff?.requiresReauthorization === true,
  );
  assert.equal(submits, 0);
});

test('detached G-account Soroban authorization must satisfy live medium threshold before Request freeze', async () => {
  const store = new MemoryStore();
  const fixture = sorobanTransaction({ prepared: true, detached: true });
  const sourceSnapshot = accountSnapshot(fixture.source, fixture.second, 2);
  const authorizerSnapshot = detachedAuthorizerSnapshot(
    fixture.authorizer.publicKey(),
    fixture.authorizerSignerA,
    fixture.authorizerSignerB,
  );
  const accountLoader = async (accountId: string) =>
    accountId === fixture.authorizer.publicKey() ? authorizerSnapshot : sourceSnapshot;

  const oneSignature = await signDetachedSorobanEntry(
    fixture.transaction.toXdr(),
    fixture.authorizerSignerA,
  );
  await assert.rejects(
    createSigningRequest(
      store,
      { network: 'testnet', xdr: oneSignature },
      { accountLoader, networkParametersLoader, idFactory: () => 'R'.repeat(16) },
    ),
    (cause: unknown) => cause instanceof SigningRequestServiceError
      && cause.code === 'soroban_authorization_incomplete',
  );

  const complete = await signDetachedSorobanEntry(oneSignature, fixture.authorizerSignerB);
  const created = await createSigningRequest(
    store,
    { network: 'testnet', xdr: complete },
    { accountLoader, networkParametersLoader, sorobanExecutionVerifier: verifiedSorobanExecution, idFactory: () => 'T'.repeat(16) },
  );
  assert.equal(created.status, 'awaiting_signatures');
});

test('frozen Soroban Proposal blocks when auth expires or the authorizer policy drifts', async () => {
  const store = new MemoryStore();
  const fixture = sorobanTransaction({ prepared: true, detached: true });
  const sourceSnapshot = accountSnapshot(fixture.source, fixture.second, 2);
  let authorizerSnapshot = detachedAuthorizerSnapshot(
    fixture.authorizer.publicKey(),
    fixture.authorizerSignerA,
    fixture.authorizerSignerB,
  );
  let ledgerSequence = 100;
  const accountLoader = async (accountId: string) =>
    accountId === fixture.authorizer.publicKey() ? authorizerSnapshot : sourceSnapshot;
  const liveNetworkParameters = async () => ({
    ledgerSequence,
    ledgerClosedAt: new Date(0).toISOString(),
    baseFeeInStroops: 100,
    baseReserveInStroops: 5_000_000,
  });
  const complete = await signDetachedSorobanEntry(
    await signDetachedSorobanEntry(fixture.transaction.toXdr(), fixture.authorizerSignerA, 500),
    fixture.authorizerSignerB,
    500,
  );
  const id = 'V'.repeat(16);
  const created = await createSigningRequest(
    store,
    { network: 'testnet', xdr: complete },
    { accountLoader, networkParametersLoader: liveNetworkParameters, sorobanExecutionVerifier: verifiedSorobanExecution, idFactory: () => id },
  );
  assert.equal(created.status, 'awaiting_signatures');

  ledgerSequence = 500;
  const expired = await getSigningRequest(store, id, {
    accountLoader,
    networkParametersLoader: liveNetworkParameters,
    transactionLoader: async () => null,
  });
  assert.equal(expired.status, 'blocked');
  assert.equal(expired.statusReason, 'soroban_authorization_expired');

  ledgerSequence = 100;
  authorizerSnapshot = {
    ...authorizerSnapshot,
    thresholds: { ...authorizerSnapshot.thresholds, medium: 3, high: 3 },
  };
  const drifted = await getSigningRequest(store, id, {
    accountLoader,
    networkParametersLoader: liveNetworkParameters,
    transactionLoader: async () => null,
  });
  assert.equal(drifted.status, 'blocked');
  assert.equal(drifted.statusReason, 'soroban_authorization_invalid');
});

test('builds a request projection from an already-authorized stored request without reloading it', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const accountLoader = async () => accountSnapshot(source, second, 2);
  const id = 'Z'.repeat(16);
  await createSigningRequest(store, { network: 'testnet', xdr: transaction.toXdr() }, {
    accountLoader,
    idFactory: () => id,
  });
  const stored = store.requests.get(id)!;
  store.getRequest = async () => {
    throw new Error('stored projection must not reload request.json');
  };
  store.listContributions = async () => {
    throw new Error('preloaded history facts must not reload contributions');
  };
  store.getSubmission = async () => {
    throw new Error('preloaded history facts must not reload submission');
  };

  const snapshot = await getSigningRequestForStoredRequest(
    store,
    stored,
    { accountLoader },
    { contributions: [], submission: null },
  );

  assert.equal(snapshot.id, id);
  assert.equal(snapshot.status, 'awaiting_signatures');
});

test('treats an identical repeated signed copy as idempotent', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const accountLoader = async () => accountSnapshot(source, second, 2);
  const id = 'B'.repeat(16);
  await createSigningRequest(store, { network: 'testnet', xdr: transaction.toXdr() }, { accountLoader, idFactory: () => id });

  const signed = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  signed.sign(source);
  await contributeSigningRequest(store, id, signed.toXdr(), { accountLoader });
  const duplicate = await contributeSigningRequest(store, id, signed.toXdr(), { accountLoader });

  assert.equal(duplicate.addedSignatureCount, 0);
  assert.equal(duplicate.request.contributionCount, 1);
  assert.equal(duplicate.contributionDigest, undefined);
  assert.deepEqual(duplicate.acceptedSignerAddresses, []);
});

test('rejects a contribution signed by a key outside the current account policy', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const accountLoader = async () => accountSnapshot(source, second, 2);
  const id = 'C'.repeat(16);
  await createSigningRequest(store, { network: 'testnet', xdr: transaction.toXdr() }, { accountLoader, idFactory: () => id });

  const signed = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  signed.sign(Keypair.random());

  await assert.rejects(
    () => contributeSigningRequest(store, id, signed.toXdr(), { accountLoader }),
    (cause: unknown) => {
      assert.ok(cause instanceof SigningRequestServiceError);
      assert.equal(cause.code, 'unrecognized_signature');
      return true;
    },
  );
});

test('rejects a contribution that would make a fully authorized transaction fail with txBAD_AUTH_EXTRA', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const accountLoader = async () => accountSnapshot(source, second, 1);
  const id = 'D'.repeat(16);
  await createSigningRequest(store, { network: 'testnet', xdr: transaction.toXdr() }, { accountLoader, idFactory: () => id });

  const oversigned = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  oversigned.sign(source, second);

  await assert.rejects(
    () => contributeSigningRequest(store, id, oversigned.toXdr(), { accountLoader }),
    (cause: unknown) => {
      assert.ok(cause instanceof SigningRequestServiceError);
      assert.equal(cause.code, 'bad_auth_extra');
      return true;
    },
  );
});

test('distinguishes signer-policy drift from other blocked requests', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const id = 'P'.repeat(16);
  const initialLoader = async () => accountSnapshot(source, second, 2);
  await createSigningRequest(store, { network: 'testnet', xdr: transaction.toXdr() }, {
    accountLoader: initialLoader,
    idFactory: () => id,
  });

  const signed = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  signed.sign(second);
  await contributeSigningRequest(store, id, signed.toXdr(), { accountLoader: initialLoader });

  const replacement = Keypair.random();
  const blocked = await getSigningRequest(store, id, {
    accountLoader: async () => accountSnapshot(source, replacement, 2),
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.statusReason, 'stored_signature_unrecognized');
});

test('distinguishes extra signatures after a threshold change', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const id = 'Q'.repeat(16);
  const initialLoader = async () => accountSnapshot(source, second, 2);
  await createSigningRequest(store, { network: 'testnet', xdr: transaction.toXdr() }, {
    accountLoader: initialLoader,
    idFactory: () => id,
  });

  const sourceCopy = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  sourceCopy.sign(source);
  await contributeSigningRequest(store, id, sourceCopy.toXdr(), { accountLoader: initialLoader });
  const secondCopy = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  secondCopy.sign(second);
  await contributeSigningRequest(store, id, secondCopy.toXdr(), { accountLoader: initialLoader });

  const blocked = await getSigningRequest(store, id, {
    accountLoader: async () => accountSnapshot(source, second, 1),
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.statusReason, 'extra_signature_invalid');
});

test('keeps expired requests viewable but rejects new contributions', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const accountLoader = async () => accountSnapshot(source, second, 2);
  const id = 'E'.repeat(16);
  const created = await createSigningRequest(store, { network: 'testnet', xdr: transaction.toXdr() }, { accountLoader, idFactory: () => id });
  const expiredAt = new Date(new Date(created.expiresAt).getTime() + 1);

  const expired = await getSigningRequest(store, id, { accountLoader, now: expiredAt });
  assert.equal(expired.status, 'expired');
  assert.equal(expired.statusReason, 'request_expired');

  const signed = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  signed.sign(source);
  await assert.rejects(
    () => contributeSigningRequest(store, id, signed.toXdr(), { accountLoader, now: expiredAt }),
    (cause: unknown) => {
      assert.ok(cause instanceof SigningRequestServiceError);
      assert.equal(cause.code, 'request_expired');
      return true;
    },
  );
});

test('recognizes an externally submitted transaction after the Request TTL expires', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const id = 'F'.repeat(16);
  const accountLoader = async () => accountSnapshot(source, second, 2);
  const created = await createSigningRequest(
    store,
    { network: 'testnet', xdr: transaction.toXdr() },
    { accountLoader, idFactory: () => id },
  );
  const expiredAt = new Date(new Date(created.expiresAt).getTime() + 1);

  const detected = await getSigningRequest(store, id, {
    accountLoader,
    now: expiredAt,
    transactionLoader: async () => ({
      hash: created.transactionHash,
      ledger: 778,
      successful: true,
      createdAt: '2026-08-29T00:02:00Z',
    }),
  });

  assert.equal(detected.status, 'submitted');
  assert.equal(detected.statusReason, 'ledger_confirmed');
  assert.equal(detected.submission?.ledger, 778);
  assert.equal((await store.getSubmission(id, created.transactionHash))?.ledger, 778);
});

test('keeps an expired Request viewable when on-chain reconciliation is unavailable', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const id = 'G'.repeat(16);
  const accountLoader = async () => accountSnapshot(source, second, 2);
  const created = await createSigningRequest(
    store,
    { network: 'testnet', xdr: transaction.toXdr() },
    { accountLoader, idFactory: () => id },
  );
  const expiredAt = new Date(new Date(created.expiresAt).getTime() + 1);

  const expired = await getSigningRequest(store, id, {
    accountLoader,
    now: expiredAt,
    transactionLoader: async () => { throw new Error('Horizon unavailable'); },
  });

  assert.equal(expired.status, 'expired');
});

test('marks a request stale when the transaction source sequence has already advanced', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const id = 'H'.repeat(16);
  await createSigningRequest(
    store,
    { network: 'testnet', xdr: transaction.toXdr() },
    { accountLoader: async () => accountSnapshot(source, second, 2, '1'), idFactory: () => id },
  );

  const stale = await getSigningRequest(store, id, {
    accountLoader: async () => accountSnapshot(source, second, 2, '2'),
    transactionLoader: async () => null,
  });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.statusReason, 'sequence_stale');
  assert.match(stale.statusDetail ?? '', /already moved past/);
});


test('recognizes an externally submitted transaction when a Request becomes stale', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const id = 'J'.repeat(16);
  const initialAccount = accountSnapshot(source, second, 2, '1');
  const created = await createSigningRequest(
    store,
    { network: 'testnet', xdr: transaction.toXdr() },
    { accountLoader: async () => initialAccount, idFactory: () => id },
  );

  const detected = await getSigningRequest(store, id, {
    accountLoader: async () => accountSnapshot(source, second, 2, '2'),
    transactionLoader: async () => ({
      hash: created.transactionHash,
      ledger: 777,
      successful: true,
      createdAt: '2026-08-29T00:01:00Z',
    }),
  });

  assert.equal(detected.status, 'submitted');
  assert.equal(detected.submission?.ledger, 777);
  assert.equal((await store.getSubmission(id, created.transactionHash))?.ledger, 777);
});

test('reconciliation never attributes an already-confirmed transaction to the current caller', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const id = 'R'.repeat(16);
  const accountLoader = async () => accountSnapshot(source, second, 2);
  const created = await createSigningRequest(
    store,
    { network: 'testnet', xdr: transaction.toXdr() },
    { accountLoader, idFactory: () => id },
  );

  const reconciled = await submitSigningRequest(store, id, {
    accountLoader,
    submittedByAddress: second.publicKey(),
    transactionLoader: async () => ({
      hash: created.transactionHash,
      ledger: 999,
      successful: true,
      createdAt: '2026-08-29T00:03:00Z',
    }),
    transactionSubmitter: async () => { throw new Error('must not broadcast after reconciliation'); },
  });

  assert.equal(reconciled.status, 'submitted');
  assert.equal((await store.listActivityEvents(id)).some((item) => item.type === 'transaction_submitted'), false);
});

test('submits a ready request once, records the result, and rejects later signatures', async () => {
  const store = new MemoryStore();
  const { source, second, transaction } = paymentTransaction();
  const accountLoader = async () => accountSnapshot(source, second, 2);
  const id = 'K'.repeat(16);
  await createSigningRequest(store, { network: 'testnet', xdr: transaction.toXdr() }, { accountLoader, idFactory: () => id });

  const sourceCopy = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  sourceCopy.sign(source);
  await contributeSigningRequest(store, id, sourceCopy.toXdr(), { accountLoader });
  const secondCopy = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  secondCopy.sign(second);
  const ready = await contributeSigningRequest(store, id, secondCopy.toXdr(), { accountLoader });
  assert.equal(ready.request.status, 'ready');

  let submitCalls = 0;
  const submitted = await submitSigningRequest(store, id, {
    accountLoader,
    transactionLoader: async () => null,
    transactionSubmitter: async () => {
      submitCalls += 1;
      return {
        hash: ready.request.transactionHash,
        ledger: 12345,
        successful: true,
        createdAt: '2026-08-29T00:00:00Z',
      };
    },
    submittedByAddress: source.publicKey(),
  });
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.statusReason, 'ledger_confirmed');
  assert.equal(submitted.submission?.ledger, 12345);
  assert.equal(submitCalls, 1);
  const submitEvent = (await store.listActivityEvents(id)).find((item) => item.type === 'transaction_submitted');
  assert.equal(submitEvent?.actorAddress, source.publicKey());

  const replay = await submitSigningRequest(store, id, {
    accountLoader,
    transactionLoader: async () => { throw new Error('should not be called'); },
    transactionSubmitter: async () => { throw new Error('should not be called'); },
  });
  assert.equal(replay.status, 'submitted');
  assert.equal(submitCalls, 1);

  await assert.rejects(
    () => contributeSigningRequest(store, id, sourceCopy.toXdr(), { accountLoader }),
    (cause: unknown) => {
      assert.ok(cause instanceof SigningRequestServiceError);
      assert.equal(cause.code, 'request_submitted');
      return true;
    },
  );
});
