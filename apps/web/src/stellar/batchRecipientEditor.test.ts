import assert from 'node:assert/strict';
import test from 'node:test';
import { appendBatchRecipientRow, batchRecipientRowsFromInput, batchRecipientRowsToInput, removeBatchRecipientRow } from './batchRecipientEditor.js';

test('multiple-recipient editor hydrates legacy CSV, tabular, and header drafts', () => {
  assert.deepEqual(batchRecipientRowsFromInput('recipient,amount,asset\nAlice, 1.5, USDC\nBob\t2\tXLM'), [
    { recipient: 'Alice', amount: '1.5', asset: 'USDC' },
    { recipient: 'Bob', amount: '2', asset: 'XLM' },
  ]);
});

test('row editor serialization preserves recipient labels and asset issuers safely', () => {
  const input = batchRecipientRowsToInput([
    { recipient: 'Ops, West', amount: '1.2500000', asset: 'USDC:GISSUER' },
    { recipient: 'Bob', amount: '2', asset: 'XLM' },
  ]);
  assert.equal(input, '"Ops, West", 1.2500000, USDC:GISSUER\nBob, 2, XLM');
  assert.deepEqual(batchRecipientRowsFromInput(input), [
    { recipient: 'Ops, West', amount: '1.2500000', asset: 'USDC:GISSUER' },
    { recipient: 'Bob', amount: '2', asset: 'XLM' },
  ]);
});

test('row editor keeps one editable row while ignoring untouched blank rows in stored input', () => {
  const empty = batchRecipientRowsFromInput('');
  assert.deepEqual(empty, [{ recipient: '', amount: '', asset: 'XLM' }]);
  assert.equal(batchRecipientRowsToInput(empty), '');
  const two = appendBatchRecipientRow(empty);
  assert.equal(two.length, 2);
  assert.deepEqual(removeBatchRecipientRow(two, 0), [{ recipient: '', amount: '', asset: 'XLM' }]);
});

test('malformed legacy rows remain visible for Human repair instead of being discarded', () => {
  assert.deepEqual(batchRecipientRowsFromInput('Alice has too many columns'), [
    { recipient: 'Alice has too many columns', amount: '', asset: 'XLM' },
  ]);
});
