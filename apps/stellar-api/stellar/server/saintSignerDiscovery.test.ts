import assert from 'node:assert/strict';
import test from 'node:test';

import { discoverSaintSignerResources, SaintConsumerError } from './saintSignerDiscovery.js';
import { GET as signerDiscoveryRoute } from '../routes/saint-signer-resources.js';

const signer = 'GC6QGJOJOMK7KUVGMFTJSQRNMD6O6VV6U2BMTE5STDEN22WWH3KS5RCZ';
const treasury = 'GBSRIGOOKQMM33DT7VEK5L3WCKA6323PYYMEPNZ6O2ME22QJVYLMCW3U';

const health = {
  network: 'testnet',
  network_fingerprint: 'testnet-fingerprint',
  registry_set_id: 'registry-generation-a',
  status: 'healthy',
};

const report = {
  schema: 'saint.signer-resources.v1',
  status: 'partial',
  publication: {
    network: 'testnet-fingerprint',
    registry: 'registry-generation-a',
    from: 2,
    through: 5843202,
  },
  global_scope_complete: false,
  classic_origin_covered: true,
  index_caught_up: true,
  targets: [
    { address: treasury, status: 'configured', state: { status: 'present' } },
    { address: signer, status: 'configured', state: { status: 'present' } },
  ],
  continuations: [],
  graph: {
    complete_within_scope: false,
    frontier: [{ reason: 'role_catalog_page_limit' }],
    relations: [
      {
        from: 'ed25519_key:' + signer,
        to: 'address:' + treasury,
        kind: 'classic_signer_key',
        conditions: { weight: 1 },
        proof: { source: 'stellar_rpc', observed_at_ledger: 5843222 },
      },
      {
        from: 'ed25519_key:' + signer,
        to: 'address:' + signer,
        kind: 'classic_master_key',
        conditions: { weight: 1 },
        proof: { source: 'stellar_rpc', observed_at_ledger: 5843222 },
      },
    ],
  },
};

function mockReplies(
  healthResponse: unknown = health,
  reportResponse: unknown = report,
): { fetcher: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetcher = (async (url: RequestInfo | URL, options?: RequestInit) => {
    const parsed = new URL(String(url));
    calls.push(parsed.toString());
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).has('authorization'), false);
    assert.equal(new Headers(options?.headers).has('cookie'), false);
    return Response.json(parsed.pathname === '/healthz' ? healthResponse : reportResponse);
  }) as typeof fetch;
  return { fetcher, calls };
}

test('SAINT discovery preserves partial coverage and only current RPC-configured links', async () => {
  const { fetcher, calls } = mockReplies();
  const result = await discoverSaintSignerResources(signer, 'http://100.96.0.4:18510', fetcher);
  assert.equal(result.network, 'testnet');
  assert.equal(result.status, 'partial');
  assert.equal(result.globalScopeComplete, false);
  assert.equal(result.scopeComplete, false);
  assert.equal(result.classicOriginCovered, true);
  assert.deepEqual(result.frontiers, ['role_catalog_page_limit']);
  assert.deepEqual(result.resources.map((item) => item.address), [treasury, signer].sort());
  assert.equal(result.resources.find((item) => item.address === treasury)?.weight, 1);
  assert.equal(result.resources.find((item) => item.address === treasury)?.observedAtLedger, 5843222);
  assert.equal(calls.length, 2);
  const requested = new URL(calls[1]);
  assert.equal(requested.pathname, '/v1/signer-resources');
  assert.equal(requested.searchParams.get('subject'), signer);
  assert.equal(requested.searchParams.get('kind'), 'ed25519_key');
});

test('SAINT discovery does not present historical candidates or edges without live proof', async () => {
  const decoy = 'GDMBKJFQPEWIIHOOKPYQTGB7PCEAEVFYECLV5AFDSS372VW7IPN5Q4Q4';
  const next = structuredClone(report);
  next.targets.push({ address: decoy, status: 'candidate', state: { status: 'present' } });
  next.graph.relations.push({
    from: 'ed25519_key:' + signer,
    to: 'address:' + decoy,
    kind: 'historic_candidate',
    conditions: { weight: 1 },
    proof: { source: 'historical_index', observed_at_ledger: 5843222 },
  });
  const { fetcher } = mockReplies(health, next);
  const result = await discoverSaintSignerResources(signer, 'http://100.96.0.4:18510', fetcher);
  assert.equal(result.resources.some((item) => item.address === decoy), false);
});

test('SAINT refuses wrong network/registry and malformed source responses', async () => {
  const wrong = mockReplies({ ...health, network: 'public' });
  await assert.rejects(discoverSaintSignerResources(signer, 'http://100.96.0.4:18510', wrong.fetcher),
    (error: unknown) => error instanceof SaintConsumerError && error.code === 'saint_invalid_response');
  const stale = mockReplies(health, { ...report, publication: { ...report.publication, registry: 'another-generation' } });
  await assert.rejects(discoverSaintSignerResources(signer, 'http://100.96.0.4:18510', stale.fetcher),
    (error: unknown) => error instanceof SaintConsumerError && error.code === 'saint_invalid_response');
  const malformed = mockReplies(health, { ...report, graph: { ...report.graph, relations: null } });
  await assert.rejects(discoverSaintSignerResources(signer, 'http://100.96.0.4:18510', malformed.fetcher),
    (error: unknown) => error instanceof SaintConsumerError && error.code === 'saint_invalid_response');
});

test('SAINT rejects invalid signer input before network request', async () => {
  const { fetcher, calls } = mockReplies();
  await assert.rejects(discoverSaintSignerResources('not-a-Stellar-address', 'http://100.96.0.4:18510', fetcher));
  assert.equal(calls.length, 0);
});

test('SAINT network failure does not become an empty success', async () => {
  const unavailable = (async () => { throw new Error('network down'); }) as typeof fetch;
  await assert.rejects(discoverSaintSignerResources(signer, 'http://100.96.0.4:18510', unavailable),
    (error: unknown) => error instanceof SaintConsumerError && error.code === 'saint_unavailable');
});

test('SAINT API requires a verified signer session before accessing the consumer', async () => {
  const response = await signerDiscoveryRoute(new Request('https://stellar-testnet.multisig.tools/stellar/saint-signer-resources'));
  assert.equal(response.status, 401);
  const body = await response.json() as { code: string };
  assert.equal(body.code, 'authentication_required');
});
