import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPortableEvidenceRecord } from './portableEvidence.js';

const SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const SIGNER = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBR5';

test('portable evidence drops private-context events and keeps exact audit actors', () => {
  const record = buildPortableEvidenceRecord({
    snapshot: {
      id: 'ABCD1234',
      network: 'testnet',
      transactionHash: 'deadbeef',
      createdAt: '2026-09-07T00:00:00.000Z',
      expiresAt: '2026-09-08T00:00:00.000Z',
      signatureCount: 1,
      submission: { transactionHash: 'deadbeef', ledger: 12345, submittedAt: '2026-09-07T00:05:00.000Z' },
    } as any,
    activity: {
      events: [
        { eventId: 'private', type: 'private_note_added', occurredAt: '2026-09-07T00:01:00.000Z', actorAddress: SOURCE, detail: 'SECRET_PRIVATE_NOTE' },
        { eventId: 'signed', type: 'approval_added', occurredAt: '2026-09-07T00:02:00.000Z', actorAddress: SOURCE, detail: 'SECRET_SIGNER_LABEL' },
        { eventId: 'legacy-ready', type: 'approvals_ready', occurredAt: '2026-09-07T00:03:00.000Z' },
        { eventId: 'legacy-blocked', type: 'request_blocked', occurredAt: '2026-09-07T00:04:00.000Z' },
        { eventId: 'confirmed', type: 'transaction_confirmed', occurredAt: '2026-09-07T00:05:00.000Z', ledger: 12345 },
      ],
    } as any,
    inspection: { transactionSourceAccount: SOURCE } as any,
    sourceAnalyses: [{
      account: {
        accountId: SOURCE,
        signers: [
          { key: SOURCE, type: 'ed25519_public_key', weight: 1 },
          { key: SIGNER, type: 'ed25519_public_key', weight: 1 },
        ],
      },
    }] as any,
  });

  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes('SECRET_PRIVATE_NOTE'), false);
  assert.equal(serialized.includes('SECRET_SIGNER_LABEL'), false);
  assert.deepEqual(record.history.map((event) => event.type), ['approval_added', 'transaction_confirmed']);
  assert.equal(record.history.find((event) => event.type === 'approval_added')?.actorAddress, SOURCE);
  assert.equal(record.accounts[0]?.address, SOURCE);
  assert.equal(record.accounts[0]?.signers[0]?.role, 'account_key');
  assert.equal(record.accounts[0]?.signers[0]?.decision, 'signed');
});
