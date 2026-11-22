import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

function source(name: string) {
  return readFileSync(new URL('../' + name, import.meta.url), 'utf8');
}

test('sign-up language is consistent at every screen size', () => {
  const account = source('StellarAccountControl.tsx');
  assert.match(account, /Sign in \/ Sign up/);
  assert.doesNotMatch(account, /sm:hidden[^>]*>\{identity \? 'Account' : 'Create account'\}/);
  assert.match(source('InboxEntryApp.tsx'), /Sign in \/ Sign up/);
  assert.match(source('IdentityApp.tsx'), /Create Passkey account/);
});

test('account management presents credentials, not a chain-auth tutorial', () => {
  const account = source('IdentityApp.tsx');
  assert.match(account, /Login methods/);
  assert.match(account, /Link wallet/);
  assert.doesNotMatch(account, /Signing authority|MST login alone does not authorize|Chain signing still follows/);
});

test('security warnings appear at the action, without repetitive architecture copy', () => {
  const signing = source('SigningGuidance.tsx');
  const request = source('RequestApp.tsx');
  assert.match(signing, /Sign with Stellar wallet/);
  assert.match(signing, /Anyone with this link can view the proposal and submit it/);
  assert.doesNotMatch(signing, /Invitations do not reserve signing slots|Your Passkey signs you in to MST/);
  assert.match(request, /Once Stellar confirms it, this transaction cannot be withdrawn/);
});

test('Testnet landing offers a workflow instead of runtime-boundary lessons', () => {
  const landing = source('StellarTestnetLandingApp.tsx');
  assert.match(landing, /Try multisig on Testnet/);
  assert.match(landing, /TESTNET_STEPS/);
  assert.doesNotMatch(landing, /Network stays fixed|State stays isolated|Product content stays canonical/);
});
