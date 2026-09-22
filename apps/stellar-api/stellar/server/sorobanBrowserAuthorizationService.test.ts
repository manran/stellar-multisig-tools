import assert from 'node:assert/strict';
import test from 'node:test';
import { Address, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk/base';
import { emptySorobanEffectsSnapshot } from '../../../../packages/stellar-core/src/sorobanEffects.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';
import type { StoredSorobanIntent } from './sorobanIntentStore.js';
import type {
  SorobanBrowserAuthorizationStore,
  StoredSorobanBrowserAuthorizationCapability,
} from './sorobanBrowserAuthorizationStore.js';
import {
  authenticateSorobanBrowserAuthorizationCapability,
  issueSorobanBrowserAuthorizationCapability,
  normalizeBrowserAuthorizationOrigin,
  projectSorobanBrowserAuthorization,
  SorobanBrowserAuthorizationServiceError,
} from './sorobanBrowserAuthorizationService.js';

class MemoryCapabilityStore implements SorobanBrowserAuthorizationStore {
  values = new Map<string, StoredSorobanBrowserAuthorizationCapability>();
  async getCapability(capabilityId: string) { return this.values.get(capabilityId) ?? null; }
  async putCapability(record: StoredSorobanBrowserAuthorizationCapability) {
    this.values.set(record.capabilityId, record);
  }
}

function fixture() {
  const signer = Keypair.random();
  const authorizer = Keypair.random();
  const args = new xdr.InvokeContractArgs({
    contractAddress: new Address('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE').toScAddress(),
    functionName: 'transfer',
    args: [nativeToScVal(authorizer.publicKey())],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
    subInvocations: [],
  });
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(authorizer.publicKey()).toScAddress(),
      nonce: xdr.Int64(42n),
      signatureExpirationLedger: 460,
      signature: xdr.ScVal.scvVec([]),
    })),
    rootInvocation: invocation,
  });
  const intentDigest = 'a'.repeat(64);
  const planDigest = 'b'.repeat(64);
  const stored: StoredSorobanIntent = {
    version: 1,
    id: 'I'.repeat(16),
    network: 'testnet',
    intent: {
      version: 1,
      network: 'testnet',
      hostFunctionXdr: xdr.HostFunction.hostFunctionTypeInvokeContract(args).toXdr('base64'),
      intentDigest,
    },
    authorizationPlan: {
      version: 1,
      network: 'testnet',
      intentDigest,
      authorizationPlanDigest: planDigest,
      authorizationEntriesXdr: [entry.toXdr('base64')],
      effects: emptySorobanEffectsSnapshot(),
      executionBinding: 'detached',
    },
    authorizationPlanRevision: 3,
    createdAt: '2026-09-19T10:00:00.000Z',
    discoverySignerKeys: [signer.publicKey()],
    integration: { version: 1, serviceId: 'fednetwork', serviceLabel: 'FedNetwork' },
  };
  const authorization: SorobanIntentAuthorizationSnapshot = {
    id: stored.id,
    network: 'testnet',
    intentDigest,
    authorizationPlanDigest: planDigest,
    executionBinding: 'detached',
    status: 'awaiting_authorization',
    authorizationEntriesXdr: [entry.toXdr('base64')],
    contributionCount: 0,
    authorizers: [{
      entryIndex: 0,
      authorizer: authorizer.publicKey(),
      credentialType: 'addressV2',
      expirationLedger: 460,
      threshold: 1,
      signedWeight: 0,
      signerEvidence: [],
      activeSigners: [{ publicKey: signer.publicKey(), weight: 1 }],
      ready: false,
    }],
  };
  return { signer, stored, authorization };
}

test('Integration issues a short-lived signer/origin/plan-scoped mic capability without storing its secret', async () => {
  const f = fixture();
  const store = new MemoryCapabilityStore();
  const result = await issueSorobanBrowserAuthorizationCapability(
    store,
    f.stored,
    f.authorization,
    {
      integrationServiceId: 'fednetwork',
      signerAddress: f.signer.publicKey(),
      origin: 'https://fed.network',
    },
    {
      now: new Date('2026-09-19T10:00:00Z'),
      idFactory: () => 'capability01',
      secretFactory: () => 's'.repeat(43),
    },
  );

  assert.equal(result.capability, `mic_capability01_${'s'.repeat(43)}`);
  assert.equal(result.record.intentId, f.stored.id);
  assert.equal(result.record.authorizationPlanRevision, 3);
  assert.equal(result.record.authorizationPlanDigest, 'b'.repeat(64));
  assert.equal(result.record.signerAddress, f.signer.publicKey());
  assert.equal(result.record.origin, 'https://fed.network');
  assert.equal(result.record.expiresAt, '2026-09-19T10:30:00.000Z');
  assert.equal(JSON.stringify(result.record).includes(result.capability), false);
  assert.equal(JSON.stringify(result.record).includes('s'.repeat(43)), false);
});

test('Browser capability authenticates only the bound origin/current plan and projects signer-specific challenge', async () => {
  const f = fixture();
  const store = new MemoryCapabilityStore();
  const issued = await issueSorobanBrowserAuthorizationCapability(
    store,
    f.stored,
    f.authorization,
    {
      integrationServiceId: 'fednetwork',
      signerAddress: f.signer.publicKey(),
      origin: 'https://fed.network',
    },
    {
      now: new Date('2026-09-19T10:00:00Z'),
      idFactory: () => 'capability02',
      secretFactory: () => 't'.repeat(43),
    },
  );

  const authenticated = await authenticateSorobanBrowserAuthorizationCapability(
    store,
    f.stored,
    f.authorization,
    { capability: issued.capability, origin: 'https://fed.network' },
    new Date('2026-09-19T10:05:00Z'),
  );
  const projection = projectSorobanBrowserAuthorization(
    f.stored,
    f.authorization,
    authenticated,
    'https://stellar-testnet.multisig.tools/a#IIIIIIIIIIIIIIII',
  );
  assert.equal(projection.signerAddress, f.signer.publicKey());
  assert.equal(projection.challenges.length, 1);
  assert.equal(projection.challenges[0]?.entryIndex, 0);
  assert.match(projection.challenges[0]?.preimageXdr ?? '', /^[A-Za-z0-9+/=]+$/);
  assert.equal(JSON.stringify(projection).includes('authorizationEntriesXdr'), false);

  await assert.rejects(
    () => authenticateSorobanBrowserAuthorizationCapability(
      store,
      f.stored,
      f.authorization,
      { capability: issued.capability, origin: 'https://evil.example' },
      new Date('2026-09-19T10:05:00Z'),
    ),
    (cause: unknown) => cause instanceof SorobanBrowserAuthorizationServiceError
      && cause.code === 'browser_capability_origin_denied',
  );

  const replanned = {
    ...f.stored,
    authorizationPlanRevision: 4,
    authorizationPlan: {
      ...f.stored.authorizationPlan,
      authorizationPlanDigest: 'c'.repeat(64),
    },
  };
  await assert.rejects(
    () => authenticateSorobanBrowserAuthorizationCapability(
      store,
      replanned,
      { ...f.authorization, authorizationPlanDigest: 'c'.repeat(64) },
      { capability: issued.capability, origin: 'https://fed.network' },
      new Date('2026-09-19T10:05:00Z'),
    ),
    (cause: unknown) => cause instanceof SorobanBrowserAuthorizationServiceError
      && cause.code === 'browser_capability_stale',
  );
});

test('Browser capability expiry and origin normalization fail closed', async () => {
  const f = fixture();
  const store = new MemoryCapabilityStore();
  const issued = await issueSorobanBrowserAuthorizationCapability(
    store,
    f.stored,
    f.authorization,
    {
      integrationServiceId: 'fednetwork',
      signerAddress: f.signer.publicKey(),
      origin: 'http://localhost:5173',
    },
    {
      now: new Date('2026-09-19T10:00:00Z'),
      idFactory: () => 'capability03',
      secretFactory: () => 'u'.repeat(43),
    },
  );

  assert.equal(normalizeBrowserAuthorizationOrigin('http://localhost:5173'), 'http://localhost:5173');
  assert.throws(
    () => normalizeBrowserAuthorizationOrigin('http://fed.network'),
    SorobanBrowserAuthorizationServiceError,
  );
  assert.throws(
    () => normalizeBrowserAuthorizationOrigin('https://fed.network/path'),
    SorobanBrowserAuthorizationServiceError,
  );

  await assert.rejects(
    () => authenticateSorobanBrowserAuthorizationCapability(
      store,
      f.stored,
      f.authorization,
      { capability: issued.capability, origin: 'http://localhost:5173' },
      new Date('2026-09-19T10:31:00Z'),
    ),
    (cause: unknown) => cause instanceof SorobanBrowserAuthorizationServiceError
      && cause.code === 'browser_capability_expired',
  );
});
