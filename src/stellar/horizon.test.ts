import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadAccount,
  loadNetworkParameters,
  loadTransactionByHash,
  submitTransactionXdr,
  TransactionSubmissionError,
} from './horizon.js';

const ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

test('loads native XLM balance, liabilities, and sequence metadata with an account snapshot', async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    account_id: ACCOUNT,
    sequence: '123',
    sequence_ledger: 120,
    sequence_time: '1787937000',
    subentry_count: 4,
    num_sponsoring: 2,
    num_sponsored: 1,
    balances: [
      { asset_type: 'credit_alphanum4', balance: '5.0000000', selling_liabilities: '0.0000000' },
      { asset_type: 'native', balance: '12.5000000', selling_liabilities: '1.2500000' },
    ],
    thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
    signers: [{ key: ACCOUNT, type: 'ed25519_public_key', weight: 1 }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const account = await loadAccount(ACCOUNT, 'testnet', undefined, fakeFetch);
  assert.equal(account.nativeBalance, '12.5000000');
  assert.equal(account.nativeSellingLiabilities, '1.2500000');
  assert.equal(account.sequenceLedger, 120);
  assert.equal(account.sequenceTime, '1787937000');
  assert.equal(account.numSponsoring, 2);
  assert.equal(account.numSponsored, 1);
});

test('loads the latest network base reserve, fee, sequence, and close time from Horizon', async () => {
  let requestedUrl = '';
  const fakeFetch: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      _embedded: {
        records: [{
          sequence: 123456,
          closed_at: '2026-08-29T01:23:45Z',
          base_fee_in_stroops: 250,
          base_reserve_in_stroops: 5000000,
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const parameters = await loadNetworkParameters('public', undefined, fakeFetch);
  assert.equal(requestedUrl, 'https://horizon.stellar.org/ledgers?order=desc&limit=1');
  assert.deepEqual(parameters, {
    ledgerSequence: 123456,
    ledgerClosedAt: '2026-08-29T01:23:45Z',
    baseFeeInStroops: 250,
    baseReserveInStroops: 5000000,
  });
});

test('loads a submitted transaction by hash', async () => {
  let requestedUrl = '';
  const fakeFetch: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      hash: 'abc123',
      ledger: 987,
      successful: true,
      created_at: '2026-08-28T00:00:00Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await loadTransactionByHash('abc123', 'testnet', undefined, fakeFetch);
  assert.equal(requestedUrl, 'https://horizon-testnet.stellar.org/transactions/abc123');
  assert.equal(result?.ledger, 987);
  assert.equal(result?.createdAt, '2026-08-28T00:00:00Z');
});

test('returns null when a transaction hash is not yet on Horizon', async () => {
  const fakeFetch: typeof fetch = async () => new Response('{}', { status: 404 });
  assert.equal(await loadTransactionByHash('missing', 'public', undefined, fakeFetch), null);
});

test('submits a signed XDR to the selected Horizon network', async () => {
  let requestedUrl = '';
  let requestedBody = '';
  let requestedContentType = '';
  const fakeFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBody = String(init?.body ?? '');
    requestedContentType = new Headers(init?.headers).get('content-type') ?? '';
    return new Response(JSON.stringify({
      hash: 'abc123',
      ledger: 987,
      successful: true,
      created_at: '2026-08-28T00:00:00Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await submitTransactionXdr('AAAA+/=', 'testnet', undefined, fakeFetch);

  assert.equal(requestedUrl, 'https://horizon-testnet.stellar.org/transactions');
  assert.equal(requestedContentType, 'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(requestedBody).get('tx'), 'AAAA+/=');
  assert.equal(result.hash, 'abc123');
  assert.equal(result.ledger, 987);
});

test('surfaces Stellar result codes from a rejected transaction', async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    title: 'Transaction Failed',
    detail: 'The transaction failed when submitted to the stellar network.',
    extras: {
      result_xdr: 'RESULT',
      result_codes: {
        transaction: 'tx_bad_seq',
        operations: ['op_success'],
      },
    },
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  await assert.rejects(
    () => submitTransactionXdr('AAAA', 'public', undefined, fakeFetch),
    (cause: unknown) => {
      assert.ok(cause instanceof TransactionSubmissionError);
      assert.equal(cause.httpStatus, 400);
      assert.equal(cause.transactionCode, 'tx_bad_seq');
      assert.deepEqual(cause.operationCodes, ['op_success']);
      assert.equal(cause.outcomeUnknown, false);
      assert.match(cause.message, /source account sequence changed/i);
      assert.match(cause.message, /tx_bad_seq/);
      return true;
    },
  );
});

test('explains a missing payment destination before exposing raw result codes', async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    title: 'Transaction Failed',
    detail: 'The transaction failed when submitted to the stellar network.',
    extras: {
      result_codes: {
        transaction: 'tx_failed',
        operations: ['op_no_destination'],
      },
    },
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  await assert.rejects(
    () => submitTransactionXdr('AAAA', 'testnet', undefined, fakeFetch),
    (cause: unknown) => {
      assert.ok(cause instanceof TransactionSubmissionError);
      assert.match(cause.message, /destination account does not exist/i);
      assert.match(cause.message, /tx_failed/);
      assert.match(cause.message, /op_no_destination/);
      return true;
    },
  );
});

test('marks a synchronous Horizon timeout as an unknown outcome', async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    title: 'Timeout',
    detail: 'Timed out waiting for transaction ingestion.',
  }), { status: 504, headers: { 'Content-Type': 'application/json' } });

  await assert.rejects(
    () => submitTransactionXdr('AAAA', 'public', undefined, fakeFetch),
    (cause: unknown) => {
      assert.ok(cause instanceof TransactionSubmissionError);
      assert.equal(cause.httpStatus, 504);
      assert.equal(cause.outcomeUnknown, true);
      assert.match(cause.message, /outcome is unknown/i);
      return true;
    },
  );
});
