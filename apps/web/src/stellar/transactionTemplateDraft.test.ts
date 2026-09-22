import assert from 'node:assert/strict';
import test from 'node:test';
import { clearTransactionTemplateDraft, loadTransactionTemplateDraft, saveTransactionTemplateDraft } from './transactionTemplateDraft.js';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

test('low-frequency transaction drafts stay scoped to owner, network, and template', () => {
  const state = storage();
  saveTransactionTemplateDraft(state, 'GOWNER', 'testnet', 'batch', { source: 'GSOURCE', input: 'Alice 1 XLM' });
  assert.deepEqual(loadTransactionTemplateDraft(state, 'GOWNER', 'testnet', 'batch'), { source: 'GSOURCE', input: 'Alice 1 XLM' });
  assert.equal(loadTransactionTemplateDraft(state, 'GOWNER', 'public', 'batch'), null);
  assert.equal(loadTransactionTemplateDraft(state, 'GOWNER', 'testnet', 'claimable'), null);
  clearTransactionTemplateDraft(state, 'GOWNER', 'testnet', 'batch');
  assert.equal(loadTransactionTemplateDraft(state, 'GOWNER', 'testnet', 'batch'), null);
});
