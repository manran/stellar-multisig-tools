import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { invalidateSignerAccountsCache, loadAccountsForSigner, peekAccountsForSigner } from '../../../../packages/stellar-core/src/signerAccounts.js';

function accountResponse(accountId: string, signer: string, weight: number) {
  return {
    account_id: accountId,
    sequence: '1',
    subentry_count: 0,
    num_sponsoring: 0,
    num_sponsored: 0,
    balances: [{ asset_type: 'native', balance: '10.0000000', selling_liabilities: '0.0000000' }],
    thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    signers: [{ key: signer, type: 'ed25519_public_key', weight }],
  };
}

function signerResponse(accountId: string, signer: string) {
  return new Response(JSON.stringify({
    _embedded: { records: [accountResponse(accountId, signer, 1)] },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('loads active accounts directly from the Horizon signer collection response', async () => {
  const signer = Keypair.random().publicKey();
  const activeAccount = Keypair.random().publicKey();
  const inactiveAccount = Keypair.random().publicKey();
  const seen: string[] = [];

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url.toString());
    assert.equal(url.pathname, '/accounts');
    assert.equal(url.searchParams.get('signer'), signer);
    assert.equal(url.searchParams.get('limit'), '200');
    return new Response(JSON.stringify({
      _embedded: {
        records: [
          accountResponse(activeAccount, signer, 1),
          accountResponse(inactiveAccount, signer, 0),
        ],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  const accounts = await loadAccountsForSigner(signer, 'testnet', undefined, fetchImpl);
  assert.deepEqual(accounts.map((account) => account.accountId), [activeAccount]);
  assert.equal(accounts[0].nativeBalance, '10.0000000');
  assert.equal(seen.length, 1);
});

test('signer account snapshots preserve issued assets for shared payment presentation', async () => {
  const signer = Keypair.random().publicKey();
  const account = Keypair.random().publicKey();
  const issuer = Keypair.random().publicKey();
  const fetchImpl = (async () => new Response(JSON.stringify({
    _embedded: {
      records: [{
        ...accountResponse(account, signer, 1),
        balances: [
          { asset_type: 'native', balance: '10.0000000', selling_liabilities: '0.1000000', buying_liabilities: '0.0000000' },
          { asset_type: 'credit_alphanum4', asset_code: 'USDQ', asset_issuer: issuer, balance: '1250.5000000', selling_liabilities: '2.0000000', buying_liabilities: '1.0000000', limit: '5000.0000000', is_authorized: true },
        ],
      }],
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

  const accounts = await loadAccountsForSigner(signer, 'testnet', undefined, fetchImpl);
  assert.equal(accounts[0].balances?.length, 2);
  assert.deepEqual(accounts[0].balances?.[1], {
    assetType: 'credit_alphanum4',
    assetCode: 'USDQ',
    assetIssuer: issuer,
    balance: '1250.5000000',
    sellingLiabilities: '2.0000000',
    buyingLiabilities: '1.0000000',
    limit: '5000.0000000',
    authorized: true,
  });
});

test('follows Horizon pagination beyond the first 200 signer accounts', async () => {
  const signer = Keypair.random().publicKey(); const a = Keypair.random().publicKey(); const b = Keypair.random().publicKey(); let calls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls += 1; const url = new URL(String(input));
    if (!url.searchParams.get('cursor')) return new Response(JSON.stringify({ _embedded: { records: Array.from({ length: 200 }, () => accountResponse(a, signer, 1)) }, _links: { next: { href: `${url.origin}/accounts?signer=${encodeURIComponent(signer)}&limit=200&cursor=next` } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    assert.equal(url.searchParams.get('cursor'), 'next');
    return new Response(JSON.stringify({ _embedded: { records: [accountResponse(b, signer, 1)] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const accounts = await loadAccountsForSigner(signer, 'testnet', undefined, fetchImpl);
  assert.equal(calls, 2); assert.deepEqual(accounts.map((account) => account.accountId), [a, b]);
});

test('reuses a recent signer-account result instead of hitting Horizon again', async () => {
  const signer = Keypair.random().publicKey();
  const account = Keypair.random().publicKey();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return signerResponse(account, signer);
  }) as typeof fetch;

  const first = await loadAccountsForSigner(signer, 'testnet', undefined, fetchImpl);
  const second = await loadAccountsForSigner(signer, 'testnet', undefined, fetchImpl);

  assert.equal(calls, 1);
  assert.equal(first[0].accountId, account);
  assert.equal(second[0].accountId, account);
});

test('explicit invalidation forces the next signer lookup back to Horizon', async () => {
  const signer = Keypair.random().publicKey();
  const account = Keypair.random().publicKey();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return signerResponse(account, signer);
  }) as typeof fetch;

  await loadAccountsForSigner(signer, 'testnet', undefined, fetchImpl);
  await loadAccountsForSigner(signer, 'testnet', undefined, fetchImpl);
  assert.equal(calls, 1);

  invalidateSignerAccountsCache('testnet');
  await loadAccountsForSigner(signer, 'testnet', undefined, fetchImpl);
  assert.equal(calls, 2);
});

test('coalesces concurrent lookups and lets one caller abort without cancelling the shared Horizon request', async () => {
  const signer = Keypair.random().publicKey();
  const account = Keypair.random().publicKey();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetchImpl = (async () => {
    calls += 1;
    await gate;
    return signerResponse(account, signer);
  }) as typeof fetch;
  const controller = new AbortController();

  const first = loadAccountsForSigner(signer, 'testnet', controller.signal, fetchImpl);
  const second = loadAccountsForSigner(signer, 'testnet', undefined, fetchImpl);
  controller.abort();
  release();

  await assert.rejects(first, (cause: unknown) => cause instanceof Error && cause.name === 'AbortError');
  const accounts = await second;
  assert.equal(calls, 1);
  assert.equal(accounts[0].accountId, account);
});

test('honors Horizon Retry-After and suppresses repeated signer lookups while rate limited', async () => {
  const signer = Keypair.random().publicKey();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
  }) as typeof fetch;

  await assert.rejects(
    loadAccountsForSigner(signer, 'public', undefined, fetchImpl),
    /rate limited/i,
  );
  await assert.rejects(
    loadAccountsForSigner(signer, 'public', undefined, fetchImpl),
    /rate limited/i,
  );
  assert.equal(calls, 1);
});


test('peek returns an already discovered account without another Horizon request', async () => {
  const signer = Keypair.random().publicKey();
  const account = Keypair.random().publicKey();
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return signerResponse(account, signer); }) as typeof fetch;
  assert.equal(peekAccountsForSigner(signer, 'testnet', fetchImpl), null);
  await loadAccountsForSigner(signer, 'testnet', undefined, fetchImpl);
  assert.equal(peekAccountsForSigner(signer, 'testnet', fetchImpl)?.[0]?.accountId, account);
  assert.equal(calls, 1);
});
