import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTreasuryRoute,
  treasuryActivityHrefForLocation,
  treasuryOverviewHrefForLocation,
  treasurySettingsHrefForLocation,
  treasurySigningBackHrefForLocation,
  treasurySigningHrefForLocation,
} from '../treasuryNavigation.js';

const CURRENT = 'https://stellar.multisig.tools/treasury';
const ACCOUNT = 'GDGV7V7UT3XDMQ3COT25VCQNJDW57WYPHSLFSAJEW2LLZDCDREWNAPXO';

test('treasury resource links preserve account and network context', () => {
  for (const href of [
    treasuryOverviewHrefForLocation(CURRENT, ACCOUNT, 'public'),
    treasuryActivityHrefForLocation(CURRENT, ACCOUNT, 'public'),
    treasurySettingsHrefForLocation(CURRENT, ACCOUNT, 'public'),
    treasurySigningHrefForLocation(CURRENT, ACCOUNT, 'public'),
  ]) {
    const url = new URL(href);
    assert.equal(url.searchParams.get('account'), ACCOUNT);
    assert.equal(url.searchParams.get('network'), 'public');
  }
});

test('treasury signing link keeps its optional intent', () => {
  const url = new URL(treasurySigningHrefForLocation(CURRENT, ACCOUNT, 'testnet', 'create-treasury'));
  assert.equal(url.searchParams.get('network'), 'testnet');
  assert.equal(url.searchParams.get('intent'), 'create-treasury');
});

test('create-treasury back link returns to the Treasury collection', () => {
  const url = new URL(treasurySigningBackHrefForLocation(CURRENT, ACCOUNT, 'testnet', 'create-treasury'));
  assert.equal(url.pathname, '/treasury');
  assert.equal(url.searchParams.get('account'), null);
  assert.equal(url.searchParams.get('network'), 'testnet');
});

test('existing Treasury signing back link preserves the Treasury resource', () => {
  const url = new URL(treasurySigningBackHrefForLocation(CURRENT, ACCOUNT, 'testnet'));
  assert.equal(url.pathname, '/treasury');
  assert.equal(url.searchParams.get('account'), ACCOUNT);
  assert.equal(url.searchParams.get('network'), 'testnet');
});

test('treasury route parsing accepts only explicit supported networks', () => {
  assert.deepEqual(parseTreasuryRoute(`?account=${ACCOUNT}&network=testnet`), { accountId: ACCOUNT, network: 'testnet' });
  assert.deepEqual(parseTreasuryRoute(`?account=${ACCOUNT}&network=future`), { accountId: ACCOUNT, network: null });
});
