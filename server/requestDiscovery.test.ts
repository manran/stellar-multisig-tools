import assert from 'node:assert/strict';
import test from 'node:test';
import { requestDiscoverySignerKeys, requestDiscoverySubjectsForInspection } from './requestDiscovery.js';
import type { TransactionXdrInspection } from '../src/stellar/transactionXdr.js';
import type { StellarAccountSnapshot } from '../src/stellar/types.js';

const A = 'G'.padEnd(56, 'A');
const B = 'G'.padEnd(56, 'B');
const C = 'G'.padEnd(56, 'C');

function account(accountId: string, signers: StellarAccountSnapshot['signers']): StellarAccountSnapshot {
  return {
    accountId,
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 1, high: 1 },
    signers,
  };
}

test('request discovery indexes every source account and direct G-address extra signer', () => {
  const inspection = {
    sourceRequirements: [
      { accountId: B },
      { accountId: A },
      { accountId: B },
    ],
    extraSigners: [C, C, 'P'.padEnd(56, 'P')],
  } as Pick<TransactionXdrInspection, 'sourceRequirements' | 'extraSigners'>;

  const subjects = requestDiscoverySubjectsForInspection(inspection);
  assert.deepEqual(subjects.sourceAccountIds, [A, B]);
  assert.deepEqual(subjects.directSignerKeys, [C]);
});

test('request discovery snapshots active ed25519 signers for signer-first Inbox lookup', () => {
  const inactive = 'G'.padEnd(56, 'I');
  const payload = 'P'.padEnd(56, 'P');
  const keys = requestDiscoverySignerKeys([
    account(A, [
      { key: A, type: 'ed25519_public_key', weight: 1 },
      { key: B, type: 'ed25519_public_key', weight: 2 },
      { key: inactive, type: 'ed25519_public_key', weight: 0 },
      { key: payload, type: 'ed25519_signed_payload', weight: 1 },
    ]),
  ], [C, C]);

  assert.deepEqual(keys, [A, B, C]);
});
