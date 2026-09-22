import assert from 'node:assert/strict';
import test from 'node:test';
import { projectTransactionSemantics } from './transactionSemantics.js';
import {
  DEFAULT_DEMO_PAYMENT,
  DEMO_DESTINATION_ADDRESS,
  DEMO_NETWORK,
  DEMO_SIGNERS,
  DEMO_TREASURY_ACCOUNT,
  createDemoProposal,
  createDemoProposalFromXdr,
  demoPaymentInspection,
  demoProposalStatus,
  signDemoProposal,
  submitDemoProposal,
  validateDemoPayment,
} from './demoRuntime.js';

test('Demo builds a real Testnet XLM payment while keeping a fixed 2-of-3 teaching policy', () => {
  const inspection = demoPaymentInspection(DEFAULT_DEMO_PAYMENT);
  const semantics = projectTransactionSemantics(inspection);

  assert.equal(inspection.network, DEMO_NETWORK);
  assert.equal(inspection.transactionSourceAccount, DEMO_TREASURY_ACCOUNT.accountId);
  assert.equal(DEMO_TREASURY_ACCOUNT.thresholds.medium, 2);
  assert.equal(DEMO_TREASURY_ACCOUNT.thresholds.high, 2);
  assert.equal(DEMO_TREASURY_ACCOUNT.signers.length, 3);
  assert.equal(semantics.kind, 'payment');
  if (semantics.kind !== 'payment') return;
  assert.equal(semantics.payment.amount, '250.0000000');
  assert.equal(semantics.payment.assetCode, 'XLM');
  assert.equal(semantics.payment.destination, DEMO_DESTINATION_ADDRESS);
});

test('Demo approvals are unique, require two personas, and never auto-submit', () => {
  const initial = createDemoProposal(DEFAULT_DEMO_PAYMENT);
  const frozen = createDemoProposalFromXdr(initial.xdr);
  assert.equal(frozen.xdr, initial.xdr);
  assert.equal(demoProposalStatus(initial), 'awaiting_signatures');

  const alice = signDemoProposal(initial, 'Alice');
  assert.deepEqual(alice.signedBy, ['Alice']);
  assert.equal(demoProposalStatus(alice), 'awaiting_signatures');
  assert.strictEqual(signDemoProposal(alice, 'Alice'), alice);

  const ready = signDemoProposal(alice, 'Bob');
  assert.deepEqual(ready.signedBy, ['Alice', 'Bob']);
  assert.equal(demoProposalStatus(ready), 'ready');
  assert.equal(ready.submitted, false);

  const submitted = submitDemoProposal(ready);
  assert.equal(demoProposalStatus(submitted), 'submitted');
});

test('Demo refuses submit before quorum and validates payment input locally', () => {
  const initial = createDemoProposal(DEFAULT_DEMO_PAYMENT);
  assert.throws(() => submitDemoProposal(initial), /needs two approvals/i);
  assert.match(validateDemoPayment({ ...DEFAULT_DEMO_PAYMENT, amount: '0' }), /amount greater than 0/i);
  assert.match(validateDemoPayment({ ...DEFAULT_DEMO_PAYMENT, memo: 'x'.repeat(29) }), /28 UTF-8 bytes/i);
  assert.equal(validateDemoPayment(DEFAULT_DEMO_PAYMENT), '');
  assert.deepEqual(DEMO_SIGNERS.map((signer) => signer.name), ['Alice', 'Bob', 'Carol']);
});
