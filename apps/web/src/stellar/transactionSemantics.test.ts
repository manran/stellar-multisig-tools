import assert from 'node:assert/strict';
import test from 'node:test';
import type { InspectedOperation, TransactionXdrInspection } from '../../../../packages/stellar-core/src/transactionXdr.js';
import { projectTransactionSemantics } from './transactionSemantics.js';

const SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const OTHER = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBFKQ';

function operation(overrides: Partial<InspectedOperation> = {}): InspectedOperation {
  return {
    index: 0,
    type: 'manageData',
    source: SOURCE,
    sourceAccount: SOURCE,
    threshold: 'medium',
    title: 'Manage data',
    summary: 'key · set value',
    fields: [],
    ...overrides,
  };
}

function inspection(operations: InspectedOperation[]): TransactionXdrInspection {
  return {
    network: 'public',
    envelopeType: 'transaction',
    transactionSource: SOURCE,
    transactionSourceAccount: SOURCE,
    fee: '100',
    innerFee: '100',
    sequence: '1',
    memo: { type: 'none' },
    innerSignatureCount: 0,
    outerSignatureCount: 0,
    extraSigners: [],
    operations,
    sourceRequirements: [],
  };
}

test('projects an exact single payment into reusable semantic facts', () => {
  const projected = projectTransactionSemantics(inspection([
    operation({
      type: 'payment',
      title: 'Payment',
      summary: `25 USDC → ${OTHER}`,
      fields: [
        { label: 'Amount', value: '25' },
        { label: 'Asset', value: `USDC · ${SOURCE}`, mono: true },
        { label: 'Destination', value: OTHER, mono: true },
      ],
    }),
  ]));

  assert.equal(projected.kind, 'payment');
  assert.deepEqual(projected.payment, {
    amount: '25',
    asset: `USDC · ${SOURCE}`,
    assetCode: 'USDC',
    destination: OTHER,
    sourceAccount: SOURCE,
  });
  assert.equal(projected.sourceAccount, SOURCE);
});

test('recognizes signing-policy changes from the existing control-field contract', () => {
  const projected = projectTransactionSemantics(inspection([
    operation({ type: 'setOptions', title: 'Set account options', fields: [{ label: 'Signer weight', value: '1' }] }),
    operation({ index: 1, type: 'setOptions', title: 'Set account options', fields: [{ label: 'Medium threshold', value: '2' }] }),
  ]));

  assert.equal(projected.kind, 'signing_change');
  assert.equal(projected.signingAccountId, SOURCE);
  assert.equal(projected.operationCount, 2);
});

test('plain SetOptions metadata is not mislabeled as a signing-policy change', () => {
  const projected = projectTransactionSemantics(inspection([
    operation({ type: 'setOptions', title: 'Set account options', fields: [{ label: 'Home domain', value: 'example.com' }] }),
  ]));

  assert.equal(projected.kind, 'single_operation');
  assert.equal(projected.signingAccountId, null);
});

test('low-threshold-only SetOptions preserves the pre-refactor presentation boundary', () => {
  const projected = projectTransactionSemantics(inspection([
    operation({ type: 'setOptions', title: 'Set account options', fields: [{ label: 'Low threshold', value: '1' }] }),
  ]));

  assert.equal(projected.kind, 'single_operation');
  assert.equal(projected.signingAccountId, null);
});

test('mixed-source SetOptions remains a multi-operation transaction', () => {
  const projected = projectTransactionSemantics(inspection([
    operation({ type: 'setOptions', fields: [{ label: 'Signer weight', value: '1' }] }),
    operation({ index: 1, type: 'setOptions', source: OTHER, sourceAccount: OTHER, fields: [{ label: 'High threshold', value: '2' }] }),
  ]));

  assert.equal(projected.kind, 'multi_operation');
  assert.equal(projected.signingAccountId, null);
});

test('preserves operation titles for multi-operation presentation without deciding UI copy', () => {
  const projected = projectTransactionSemantics(inspection([
    operation({ title: 'Manage data' }),
    operation({ index: 1, type: 'changeTrust', title: 'Change trustline', summary: 'USDC' }),
  ]));

  assert.equal(projected.kind, 'multi_operation');
  assert.deepEqual(projected.operationTitles, ['Manage data', 'Change trustline']);
  assert.equal(projected.payment, null);
});


test('projects same-source payment operations as a batch payment', () => {
  const projected = projectTransactionSemantics(inspection([
    operation({ type: 'payment', title: 'Payment', fields: [{ label: 'Amount', value: '10' }, { label: 'Asset', value: 'XLM' }, { label: 'Destination', value: OTHER }] }),
    operation({ index: 1, type: 'payment', title: 'Payment', fields: [{ label: 'Amount', value: '20' }, { label: 'Asset', value: 'XLM' }, { label: 'Destination', value: SOURCE }] }),
  ]));
  assert.equal(projected.kind, 'batch_payment');
  assert.equal(projected.payments.length, 2);
  assert.equal(projected.payment, null);
});

test('projects payment operations with an independent source as multi-party', () => {
  const projected = projectTransactionSemantics(inspection([
    operation({ type: 'payment', title: 'Payment', fields: [{ label: 'Amount', value: '10' }, { label: 'Asset', value: 'XLM' }, { label: 'Destination', value: OTHER }] }),
    operation({ index: 1, type: 'payment', source: OTHER, sourceAccount: OTHER, title: 'Payment', fields: [{ label: 'Amount', value: '5' }, { label: 'Asset', value: 'XLM' }, { label: 'Destination', value: SOURCE }] }),
  ]));
  assert.equal(projected.kind, 'multi_party');
  assert.equal(projected.payments[1]?.sourceAccount, OTHER);
});

test('projects the recoverable claimable payment contract into Human semantic facts', () => {
  const projected = projectTransactionSemantics(inspection([
    operation({
      type: 'createClaimableBalance',
      title: 'Claimable payment',
      fields: [
        { label: 'Amount', value: '100' },
        { label: 'Asset', value: 'USDC · issuer' },
        { label: 'Recipient', value: OTHER },
        { label: 'Recovery account', value: SOURCE },
        { label: 'Claim window seconds', value: '2592000' },
      ],
    }),
  ]));
  assert.equal(projected.kind, 'claimable_payment');
  assert.deepEqual(projected.claimablePayment, {
    amount: '100',
    asset: 'USDC · issuer',
    assetCode: 'USDC',
    recipient: OTHER,
    recoveryAccount: SOURCE,
    claimWindowSeconds: 2592000,
  });
});
