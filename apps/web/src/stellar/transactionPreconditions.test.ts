import assert from 'node:assert/strict';
import test from 'node:test';
import { assessTransactionPreconditions } from '../../../../packages/stellar-core/src/transactionPreconditions.js';
import type { StellarNetworkParameters } from '../../../../packages/stellar-core/src/horizon.js';
import type { TransactionXdrInspection } from '../../../../packages/stellar-core/src/transactionXdr.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';

const source = (overrides: Partial<StellarAccountSnapshot> = {}): StellarAccountSnapshot => ({
  accountId: 'G...',
  sequence: '10',
  sequenceLedger: 90,
  sequenceTime: '1000',
  subentryCount: 0,
  numSponsoring: 0,
  numSponsored: 0,
  thresholds: { low: 1, medium: 1, high: 1 },
  signers: [],
  ...overrides,
});
const network = (overrides: Partial<StellarNetworkParameters> = {}): StellarNetworkParameters => ({
  ledgerSequence: 100,
  ledgerClosedAt: new Date(1100_000).toISOString(),
  baseFeeInStroops: 100,
  baseReserveInStroops: 5_000_000,
  ...overrides,
});
const tx = (overrides: Partial<TransactionXdrInspection> = {}): TransactionXdrInspection => ({
  network: 'testnet',
  envelopeType: 'transaction',
  transactionSource: 'G...',
  transactionSourceAccount: 'G...',
  fee: '100',
  innerFee: '100',
  sequence: '11',
  memo: { type: 'none' },
  innerSignatureCount: 0,
  outerSignatureCount: 0,
  extraSigners: [],
  operations: [],
  sourceRequirements: [],
  ...overrides,
});

test('accepts the direct next sequence without relaxed preconditions', () => {
  const result = assessTransactionPreconditions(tx(), source(), { networkParameters: network() });
  assert.equal(result.status, 'ready');
});

test('marks an already-consumed sequence stale', () => {
  const result = assessTransactionPreconditions(tx({ sequence: '10' }), source(), { networkParameters: network() });
  assert.equal(result.status, 'stale');
});

test('does not misclassify a valid relaxed minSeqNum gap as blocked', () => {
  const result = assessTransactionPreconditions(
    tx({ sequence: '20', minAccountSequence: '8' }),
    source({ sequence: '10' }),
    { networkParameters: network() },
  );
  assert.equal(result.status, 'ready');
  assert.match(result.checks[0].detail, /8 <= 10 < 20/);
});

test('waits until minSeqNum has been reached', () => {
  const result = assessTransactionPreconditions(
    tx({ sequence: '20', minAccountSequence: '12' }),
    source({ sequence: '10' }),
    { networkParameters: network() },
  );
  assert.equal(result.status, 'not_yet_valid');
});

test('treats 0/0 time bounds as an effective no-op without ledger context', () => {
  const result = assessTransactionPreconditions(
    tx({ timeBounds: { minTime: '0', maxTime: '0' } }),
    source(),
  );
  assert.equal(result.status, 'ready');
  assert.equal(result.readyForSubmit, true);
});

test('does not use wall clock as a substitute for missing ledger close time', () => {
  const result = assessTransactionPreconditions(
    tx({ timeBounds: { minTime: '1', maxTime: '0' } }),
    source(),
  );
  assert.equal(result.status, 'unknown');
  assert.equal(result.readyForSubmit, false);
  assert.match(result.checks.find((check) => check.code === 'time_bounds')?.detail ?? '', /ledger close time is unavailable/i);
});

test('treats time max as unusable when no future ledger can fit the bound', () => {
  const result = assessTransactionPreconditions(
    tx({ timeBounds: { minTime: '0', maxTime: '1100' } }),
    source(),
    { networkParameters: network() },
  );
  assert.equal(result.status, 'expired');
});

test('uses inclusive minLedger and exclusive maxLedger for the earliest next ledger', () => {
  assert.equal(assessTransactionPreconditions(
    tx({ ledgerBounds: { minLedger: 101, maxLedger: 102 } }), source(), { networkParameters: network() },
  ).status, 'ready');
  assert.equal(assessTransactionPreconditions(
    tx({ ledgerBounds: { minLedger: 1, maxLedger: 101 } }), source(), { networkParameters: network() },
  ).status, 'expired');
});

test('evaluates min sequence age from Horizon sequence_time and ledger close time', () => {
  assert.equal(assessTransactionPreconditions(
    tx({ minAccountSequenceAge: '100' }), source(), { networkParameters: network() },
  ).status, 'ready');
  assert.equal(assessTransactionPreconditions(
    tx({ minAccountSequenceAge: '101' }), source(), { networkParameters: network() },
  ).status, 'not_yet_valid');
});

test('evaluates min sequence ledger gap against the earliest next ledger', () => {
  assert.equal(assessTransactionPreconditions(
    tx({ minAccountSequenceLedgerGap: 11 }), source(), { networkParameters: network() },
  ).status, 'ready');
  assert.equal(assessTransactionPreconditions(
    tx({ minAccountSequenceLedgerGap: 12 }), source(), { networkParameters: network() },
  ).status, 'not_yet_valid');
});
