import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDesignerQuorums } from './designerUi.js';

test('raises account-control approvals when payment approvals increase', () => {
  assert.deepEqual(normalizeDesignerQuorums(4, 4, 2), { payment: 4, admin: 4 });
});

test('clamps both approvals when participants are removed', () => {
  assert.deepEqual(normalizeDesignerQuorums(2, 4, 4), { payment: 2, admin: 2 });
});

test('never allows account-control approvals below payment approvals', () => {
  assert.deepEqual(normalizeDesignerQuorums(5, 3, 1), { payment: 3, admin: 3 });
});
