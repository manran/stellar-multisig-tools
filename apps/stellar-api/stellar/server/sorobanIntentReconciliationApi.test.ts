import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Address, Keypair, StrKey, hash as stellarHash, nativeToScVal, xdr } from '@stellar/stellar-sdk/base';
import { createSorobanIntent, materializeSorobanIntent } from '../../../../packages/stellar-core/src/sorobanIntent.js';
import { createSorobanAuthorizationPlan, authorizationEntriesFromPlan } from '../../../../packages/stellar-core/src/sorobanAuthorizationPlan.js';
import { initializeSorobanGAccountAuthorizationWindow, sorobanAuthorizationEntryPreimageXdr } from '../../../../packages/stellar-core/src/sorobanAuthorization.js';
import { emptySorobanEffectsSnapshot } from '../../../../packages/stellar-core/src/sorobanEffects.js';
import { blobSorobanIntentStore } from './blobSorobanIntentStore.js';
import { blobAgentCredentialStore } from './blobAgentCredentialStore.js';
import { createSignerAgentCredential } from './agentCredentialService.js';
import { createIntegrationApiKey } from './integrationCredentialService.js';
import type { StoredSorobanIntent, StoredSorobanIntentExecutionPreparation } from './sorobanIntentStore.js';

test('actual Intent reconciliation route replays owner evidence without a live ledger and preserves authorization boundaries', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mst-owner-reconcile-'));
  const env = {
    MULTISIG_COORDINATION_STORAGE: 'blob',
    MULTISIG_PRIVATE_OBJECT_STORAGE: 'filesystem',
    MULTISIG_PRIVATE_OBJECT_ROOT: directory,
    VITE_STELLAR_DEPLOYMENT_NETWORK: 'testnet',
    MULTISIG_COORDINATION_WRITE_FREEZE: '0',
  };
  const names = [...Object.keys(env), 'MULTISIG_INTEGRATION_CREDENTIALS_JSON'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    await rm(directory, { recursive: true, force: true });
  });
  Object.assign(process.env, env);
  const owner = createIntegrationApiKey('fixture-owner');
  const other = createIntegrationApiKey('fixture-other');
  const executor = Keypair.random().publicKey();
  process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = JSON.stringify([
    { serviceId: 'fixture-owner', label: 'Owner fixture', secretHash: owner.secretHash, networks: ['testnet'], sorobanContracts: [{ contractId: StrKey.encodeContract(Buffer.alloc(32, 1)), methods: ['transfer'] }], sorobanExecutionAccounts: [executor] },
    { serviceId: 'fixture-other', label: 'Other fixture', secretHash: other.secretHash, networks: ['testnet'], sorobanContracts: [{ contractId: StrKey.encodeContract(Buffer.alloc(32, 1)), methods: ['transfer'] }], sorobanExecutionAccounts: [executor] },
  ]);
  const signer = Keypair.random();
  const principal = { type: 'signer' as const, network: 'testnet' as const, address: signer.publicKey() };
  const writer = await createSignerAgentCredential(blobAgentCredentialStore, principal, 'Writer fixture', 'write', principal.address);
  const reader = await createSignerAgentCredential(blobAgentCredentialStore, principal, 'Reader fixture', 'read', principal.address);
  const unrelated = { ...principal, address: Keypair.random().publicKey() };
  const stranger = await createSignerAgentCredential(blobAgentCredentialStore, unrelated, 'Other fixture', 'write', unrelated.address);
  const { PUT, PATCH, GET } = await import('../routes/intent.js');
  const hash = 'a'.repeat(64);
  const digest = 'b'.repeat(64);
  const timestamp = '2026-09-17T00:01:00Z';
  const preparation: StoredSorobanIntentExecutionPreparation = {
    version: 1, transactionHash: hash, authorizationPlanDigest: digest, authorizationPlanRevision: 1,
    executionSource: executor, transactionSequence: '1', validUntil: '2026-09-17T00:02:00Z',
    latestLedger: 10, effectsDigest: digest, effectsAccepted: true, preparedAt: timestamp,
  };
  const proof = { oldestLedger: 1, latestLedger: 20, latestLedgerClosedAt: '2026-09-17T00:03:00Z', checkedAt: '2026-09-17T00:03:01Z' };
  const ids = { successful: 'S'.repeat(16), failed: 'F'.repeat(16), not_included: 'N'.repeat(16) };
  for (const outcome of ['successful', 'failed', 'not_included'] as const) {
    const stored: StoredSorobanIntent = {
      version: 1, id: ids[outcome], network: 'testnet',
      intent: { version: 1, network: 'testnet', hostFunctionXdr: 'AAAA', intentDigest: digest },
      authorizationPlan: {
        version: 1, network: 'testnet', intentDigest: digest, authorizationPlanDigest: digest,
        authorizationEntriesXdr: [], effects: emptySorobanEffectsSnapshot(), executionBinding: 'detached',
      },
      authorizationPlanRevision: 1, createdAt: timestamp, discoverySignerKeys: [],
      creatorAddress: principal.address, integration: { version: 1, serviceId: 'fixture-owner' },
      executionPolicy: { mode: 'external', executor: { address: executor, source: 'service_default' } },
    };
    await blobSorobanIntentStore.createIntent(stored);
    await blobSorobanIntentStore.putExecutionPreparation!(stored.id, { ...preparation, ...(outcome === 'not_included' ? { nonInclusionProof: proof } : {}) });
    if (outcome !== 'not_included') await blobSorobanIntentStore.putExecutionObservation!(stored.id, {
      version: 1, transactionHash: hash, authorizationPlanDigest: digest, authorizationPlanRevision: 1,
      executionSource: executor, ledger: 15, successful: outcome === 'successful', observedAt: timestamp,
    });
  }

  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('network disabled for receipt test'); };
  const call = (id: string, credential?: string, capability?: string, transactionHash = hash) => PUT(new Request('https://example.test/intent', {
    method: 'PUT', headers: {
      'Content-Type': 'application/json', 'X-MultiSig-Intent-Id': id,
      ...(credential ? { Authorization: 'Bearer ' + credential } : {}),
      ...(capability ? { 'X-MultiSig-Intent-Capability': capability } : {}),
    },
    body: JSON.stringify({ action: 'reconcile_execution', transactionHash }),
  }));
  for (const outcome of ['successful', 'failed', 'not_included'] as const) {
    for (const credential of [owner.apiKey, writer.apiKey]) {
      const response = await call(ids[outcome], credential);
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.outcome, outcome);
      assert.equal(result.replayed, true);
      if (outcome === 'successful') {
        const projection = result.job ?? result.task;
        assert.equal(projection?.state, 'completed');
        assert.equal(projection?.result?.successful, true);
        assert.deepEqual(projection?.nextActions, []);
      } else {
        assert.equal(result.projectionNotRefreshed, true);
        assert.equal(result.job, undefined);
        assert.equal(result.task, undefined);
        if (outcome === 'failed') assert.equal(result.observation.successful, false);
        else assert.deepEqual(result.nonInclusionProof, proof);
      }
    }
  }
  for (const [credential, capability, status, code] of [
    [other.apiKey, undefined, 403, 'integration_intent_access_denied'],
    [reader.apiKey, undefined, 403, 'agent_access_denied'],
    [owner.apiKey, 'fixture-capability', 403, 'browser_capability_write_denied'],
    [undefined, undefined, 401, 'intent_authentication_required'],
  ] as const) {
    const response = await call(ids.failed, credential, capability);
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
  }
  const missing = await call(ids.failed, owner.apiKey, undefined, 'c'.repeat(64));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'intent_execution_preparation_not_found');
  assert.equal(fetches, 0, 'Owner receipt replay or denied callers performed a live lookup');
  // A non-owner cannot use stored evidence to bypass the live signer check.
  const denied = await call(ids.failed, stranger.apiKey);
  assert.notEqual(denied.status, 200);
  assert.equal((await denied.json()).observation, undefined);

  // Horizontal consumer check: an idempotent AUTH contribution after an
  // execution package was released must not advertise a second preparation.
  const sign = await createSignerAgentCredential(blobAgentCredentialStore, principal, 'Sign fixture', 'sign', principal.address);
  const contractId = StrKey.encodeContract(Buffer.alloc(32, 1));
  const args = new xdr.InvokeContractArgs({ contractAddress: new Address(contractId).toScAddress(), functionName: 'transfer', args: [nativeToScVal(principal.address)] });
  const authEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(principal.address).toScAddress(), nonce: xdr.Int64(42n), signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args), subInvocations: [] }),
  });
  const intent = createSorobanIntent('testnet', xdr.HostFunction.hostFunctionTypeInvokeContract(args));
  const raw = materializeSorobanIntent({ intent, sourceAccount: executor, sourceSequence: '7', fee: '100', lifetimeSeconds: 300, authorizationEntries: [authEntry] });
  const initialized = await initializeSorobanGAccountAuthorizationWindow({ envelopeXdr: raw.toXDR(), network: 'testnet', currentLedger: 100 });
  const plan = createSorobanAuthorizationPlan(intent, initialized, emptySorobanEffectsSnapshot());
  const pendingId = 'P'.repeat(16);
  await blobSorobanIntentStore.createIntent({
    version: 1, id: pendingId, network: 'testnet', intent, authorizationPlan: plan, authorizationPlanRevision: 1,
    createdAt: timestamp, creatorAddress: principal.address, discoverySignerKeys: [principal.address],
  });
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/ledgers?')) return Response.json({ _embedded: { records: [{ sequence: 100, closed_at: timestamp, base_fee_in_stroops: 100, base_reserve_in_stroops: 5_000_000 }] } });
    if (url.includes('/accounts/' + principal.address)) return Response.json({
      account_id: principal.address, sequence: '1', subentry_count: 0, num_sponsoring: 0, num_sponsored: 0,
      balances: [{ asset_type: 'native', balance: '100.0000000', selling_liabilities: '0.0000000', buying_liabilities: '0.0000000' }],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      signers: [{ key: principal.address, type: 'ed25519_public_key', weight: 1 }],
    });
    throw new Error('Unexpected network request in local authorization fixture');
  };
  const entry = authorizationEntriesFromPlan(plan)[0];
  const preimage = xdr.HashIdPreimage.fromXdr(sorobanAuthorizationEntryPreimageXdr({ entry, network: 'testnet', expirationLedger: 460 }), 'base64');
  const signatureBase64 = Buffer.from(signer.sign(stellarHash(preimage.toXdr()))).toString('base64');
  const headers = { 'Content-Type': 'application/json', 'X-MultiSig-Intent-Id': pendingId, Authorization: 'Bearer ' + sign.apiKey };
  const contribute = () => PATCH(new Request('https://example.test/intent', { method: 'PATCH', headers, body: JSON.stringify({ entryIndex: 0, signatureBase64 }) }));
  const challengeResponse = await GET(new Request('https://example.test/intent', { headers }));
  assert.equal(challengeResponse.status, 200);
  const challengeBody = await challengeResponse.json();
  assert.equal(challengeBody.challenges[0].preimageXdr, preimage.toXDR('base64'));
  assert.equal(challengeBody.challenges[0].entryIndex, 0);
  const first = await contribute();
  const firstBody = await first.json();
  assert.equal(first.status, 200, JSON.stringify(firstBody));
  assert.equal(firstBody.added, true);
  assert.equal(firstBody.task.nextActions[0].code, 'prepare_execution');
  await blobSorobanIntentStore.putExecutionPreparation!(pendingId, { ...preparation, authorizationPlanDigest: plan.authorizationPlanDigest });
  const repeated = await contribute();
  const repeatedBody = await repeated.json();
  assert.equal(repeated.status, 200, JSON.stringify(repeatedBody));
  assert.equal(repeatedBody.added, false);
  assert.equal(repeatedBody.task.nextActions[0].code, 'reconcile_execution');
  assert.deepEqual(repeatedBody.task.unresolvedTransactionHashes, [hash]);
  const inspected = await GET(new Request('https://example.test/intent', { headers }));
  assert.equal(inspected.status, 200);
  assert.deepEqual((await inspected.json()).task, repeatedBody.task);

  // Model a historical cancelled-then-confirmed record with a contributor
  // who is neither the creator nor a current on-chain signer.
  const historicalId = 'H'.repeat(16);
  const historical = { ...(await blobSorobanIntentStore.getIntent(pendingId))!,
    id: historicalId, creatorAddress: executor };
  await blobSorobanIntentStore.createIntent(historical);
  for (const contribution of await blobSorobanIntentStore.listContributions(pendingId)) {
    await blobSorobanIntentStore.putContribution(historicalId, contribution);
  }
  await blobSorobanIntentStore.putExecutionPreparation!(historicalId, { ...preparation, authorizationPlanDigest: plan.authorizationPlanDigest });
  await blobSorobanIntentStore.cancelIntent!(historicalId, {
    version: 1, cancelledAt: timestamp, authorizationPlanDigest: plan.authorizationPlanDigest, authorizationPlanRevision: 1,
  });
  await blobSorobanIntentStore.putExecutionObservation!(historicalId, {
    version: 1, transactionHash: hash, authorizationPlanDigest: plan.authorizationPlanDigest, authorizationPlanRevision: 1,
    executionSource: executor, ledger: 15, successful: true, observedAt: timestamp,
  });
  globalThis.fetch = async () => { throw new Error('network disabled for historical receipt'); };
  const historicalHeaders = { 'X-MultiSig-Intent-Id': historicalId, Authorization: 'Bearer ' + reader.apiKey };
  const historicalReceipt = await GET(new Request('https://example.test/intent', { headers: historicalHeaders }));
  const receiptBody = await historicalReceipt.json();
  assert.equal(historicalReceipt.status, 200, JSON.stringify(receiptBody));
  assert.equal(receiptBody.authorization.status, 'completed');
  assert.deepEqual(receiptBody.authorization.authorizationEntriesXdr, []);
  assert.deepEqual(receiptBody.task.nextActions, []);
  const historicalStranger = await GET(new Request('https://example.test/intent', {
    headers: { ...historicalHeaders, Authorization: 'Bearer ' + stranger.apiKey },
  }));
  assert.notEqual(historicalStranger.status, 200);
});
