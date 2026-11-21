import assert from 'node:assert/strict';
import test from 'node:test';

import { loadSaintAccountSecurity, SaintHistoryUnavailable } from './saintAccountSecurity.js';
import { GET as historyRoute } from '../routes/saint-account-security.js';

const address = 'GBSRIGOOKQMM33DT7VEK5L3WCKA6323PYYMEPNZ6O2ME22QJVYLMCW3U';
const fingerprint = 'testnet-fingerprint';
const through = 5_843_720;
const from = through - 64_000 + 1;

const health = {
  network: 'testnet', network_fingerprint: fingerprint, registry_set_id: 'generation-1',
  coverage_from: 2, published_through: through,
};
const control = {
  kind: 'account_control_change', account_id: address,
  source_key: 'control-1', ledger: 5841386, tx_hash: 'a'.repeat(64),
  occurred_at: '2026-11-21T03:09:31.000Z', field: 'medium_threshold',
  signer_id: null, before: 1, after: 2,
};
const signer = {
  ...control, source_key: 'control-2', field: 'signer_weight',
  signer_id: 'GC6QGJOJOMK7KUVGMFTJSQRNMD6O6VV6U2BMTE5STDEN22WWH3KS5RCZ',
  before: null, after: 1,
};
const lifecycle = {
  kind: 'account_lifecycle', account_id: address,
  source_key: 'lifecycle-1', ledger: 5841385, tx_hash: 'b'.repeat(64),
  occurred_at: '2026-11-21T03:09:26.000Z', event: 'created',
};
const history = {
  address, network_fingerprint: fingerprint, complete_window: true,
  coverage: { window: { from, through }, published: { from: 2, through } },
  families: [
    { family: 'account_control_change', status: 'available', window_exhausted: true, events: [signer, control] },
    { family: 'account_lifecycle', status: 'available', window_exhausted: true, events: [lifecycle] },
  ],
};

function fakeFetch(
  currentHealth: unknown = health,
  currentHistory: unknown = history,
): { fetcher: typeof fetch; calls: URL[] } {
  const calls: URL[] = [];
  const fetcher = (async (url: RequestInfo | URL, options?: RequestInit) => {
    calls.push(new URL(String(url)));
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    assert.equal(options?.headers, undefined);
    return Response.json(calls.at(-1)?.pathname === '/healthz' ? currentHealth : currentHistory);
  }) as typeof fetch;
  return { fetcher, calls };
}

test('bounded SAINT history returns independent policy events and provenance', async () => {
  const { fetcher, calls } = fakeFetch();
  const result = await loadSaintAccountSecurity(address, 'http://100.96.0.4:18510', fetcher);
  assert.equal(result.source, 'saint');
  assert.equal(result.network, 'testnet');
  assert.equal(result.complete, true);
  assert.deepEqual(result.window, { from, through });
  assert.equal(result.events.length, 3);
  assert.equal(result.events[0].ledger, 5841386);
  assert.ok(result.events.some((event) => event.field === 'medium_threshold' && event.before === 1 && event.after === 2));
  assert.ok(result.events.some((event) => event.kind === 'lifecycle' && event.field === 'created'));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].pathname, '/v1/account-security-history');
  assert.equal(calls[1].searchParams.get('address'), address);
  assert.equal(calls[1].searchParams.get('from'), String(from));
  assert.equal(calls[1].searchParams.get('through'), String(through));
});

test('degraded SAINT history cannot mean no changes', async () => {
  const report = structuredClone(history);
  report.complete_window = false;
  report.families[0].status = 'degraded';
  // SAINT Go serializes a degraded family's nil event slice as JSON null.
  report.families[0].events = null as unknown as typeof report.families[0]['events'];
  const result = await loadSaintAccountSecurity(address, 'http://100.96.0.4:18510', fakeFetch(health, report).fetcher);
  assert.equal(result.complete, false);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, 'lifecycle');
});

test('reject mismatched network, query window, account and malformed evidence', async () => {
  const responses = [
    { h: { ...health, network: 'public' }, report: history },
    { h: health, report: { ...history, network_fingerprint: 'mainnet-fingerprint' } },
    { h: health, report: { ...history, address: signer.signer_id } },
    { h: health, report: { ...history, coverage: { ...history.coverage, window: { from: 1, through } } } },
    { h: health, report: { ...history, families: [{ ...history.families[0], events: [{ ...control, tx_hash: 'wrong' }] }, history.families[1]] } },
  ];
  for (const { h, report } of responses) {
    await assert.rejects(loadSaintAccountSecurity(address, 'http://100.96.0.4:18510', fakeFetch(h, report).fetcher),
      (error: unknown) => error instanceof SaintHistoryUnavailable);
  }
});

test('SAINT outage and private ingress 404 are optional failures, not empty histories', async () => {
  const down = (async () => { throw new Error('down'); }) as typeof fetch;
  const blocked = (async () => new Response('Not found', { status: 404 })) as typeof fetch;
  for (const fetcher of [down, blocked]) {
    await assert.rejects(loadSaintAccountSecurity(address, 'http://100.96.0.4:18510', fetcher),
      (error: unknown) => error instanceof SaintHistoryUnavailable);
  }
});

test('SAINT endpoint requires wallet identity before any upstream request', async () => {
  const response = await historyRoute(new Request('https://stellar-testnet.multisig.tools/stellar/saint-account-security?address=' + address));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'authentication_required');
});
