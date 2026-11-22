import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { WORKSPACE_COPY } from '../workspaceCopy';

function source(name: string) {
  return readFileSync(new URL('../' + name, import.meta.url), 'utf8');
}

test('sign-up language is consistent at every screen size', () => {
  const account = source('StellarAccountControl.tsx');
  assert.match(account, /Sign in \/ Sign up/);
  assert.doesNotMatch(account, /sm:hidden[^>]*>\{identity \? 'Account' : 'Create account'\}/);
  assert.match(source('InboxEntryApp.tsx'), /Sign in \/ Sign up/);
  assert.match(source('IdentityApp.tsx'), /WORKSPACE_COPY.identity.createPasskey/);
  assert.equal(WORKSPACE_COPY.identity.createPasskey, 'Create Passkey account');
});

test('account management presents credentials, not a chain-auth tutorial', () => {
  const account = source('IdentityApp.tsx');
  assert.match(account, /WORKSPACE_COPY.identity.methods/);
  assert.match(account, /WORKSPACE_COPY.identity.link/);
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

test('tool labels are intentionally distinct and use one copy source', () => {
  assert.equal(WORKSPACE_COPY.tools.contacts, 'Address Book');
  assert.equal(WORKSPACE_COPY.tools.contracts, 'Smart Contracts');
  assert.notEqual(WORKSPACE_COPY.tools.contacts, WORKSPACE_COPY.tools.contracts);
  assert.equal(WORKSPACE_COPY.contracts.count(1), '1 saved contract');
  assert.equal(WORKSPACE_COPY.contracts.count(2), '2 saved contracts');
  for (const file of ['StellarWorkspaceShell.tsx', 'ContractsApp.tsx', 'AddressBookApp.tsx']) {
    assert.match(source(file), /WORKSPACE_COPY/);
  }
});

test('linking a wallet requires confirmation and a conflict cannot overwrite the MST account', () => {
  const identity = source('IdentityApp.tsx');
  assert.match(identity, /setConfirmLink\(true\)/);
  assert.match(identity, /WORKSPACE_COPY.identity.confirm/);
  assert.match(identity, /WORKSPACE_COPY.identity.conflict/);
  assert.match(identity, /setBlockedWallet\(unlockedAddress\)/);
  assert.match(identity, /!walletLinked && !walletBlocked/);
  const header = source('StellarAccountControl.tsx');
  assert.match(header, /identity\?\.method === 'passkey'/);
  assert.match(header, /WORKSPACE_COPY.identity.disconnectWallet/);
});