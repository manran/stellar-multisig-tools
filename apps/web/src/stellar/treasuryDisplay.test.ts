import assert from 'node:assert/strict';
import test from 'node:test';
import { treasuryDisplayLabel } from '../treasuryDisplay.js';

test('Treasury display identity prefers shared name and keeps a distinct personal label secondary', () => {
  assert.equal(treasuryDisplayLabel('Operations Treasury', 'Payroll'), 'Operations Treasury (Payroll)');
  assert.equal(treasuryDisplayLabel('Operations Treasury', ''), 'Operations Treasury');
  assert.equal(treasuryDisplayLabel('', 'Payroll'), 'Payroll');
  assert.equal(treasuryDisplayLabel('Operations Treasury', 'Operations Treasury'), 'Operations Treasury');
});
