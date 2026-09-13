import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const entry = source('../AccountSigningEntryApp.tsx');
const designer = source('../MultisigDesignerApp.tsx');
const existing = source('../ExistingMultisigPolicyEditor.tsx');
const newTransaction = source('../NewTransactionApp.tsx');
const signingRoom = source('../SigningRoomApp.tsx');
const request = source('../RequestApp.tsx');
const routes = source('../workspaceRoutes.ts');

test('standalone multisig is a low-frequency entry into the shared account-signing flow', () => {
  assert.match(newTransaction, /More Stellar actions/);
  assert.match(newTransaction, /title="Set up multisig"/);
  assert.match(newTransaction, /stellarHref\('\/account\/signing'\)/);
  assert.ok(newTransaction.indexOf('Send payment') < newTransaction.indexOf('More Stellar actions'));
  assert.match(routes, /path: '\/account\/signing'/);
  assert.match(routes, /path: '\/account\/signing\/edit'/);
});

test('standalone and offline entry faces converge on one policy editor', () => {
  assert.match(entry, /accountSigningIntentForRoute/);
  assert.match(entry, /Set up or change multisig/);
  assert.match(entry, /Set up multisig offline/);
  assert.match(entry, /navigateWorkspace\('\/account\/signing\/edit'/);
  assert.match(designer, /accountSigningIntent/);
  assert.match(designer, /accountSigningIntent === 'standalone'/);
  assert.match(designer, /accountSigningIntent === 'offline'/);
  assert.match(designer, /accountSigningIntent=\{accountSigningIntent\}/);
  assert.match(designer, /initialAccountLoadStarted/);
  assert.match(existing, /accountSigningIntent/);
});

test('account-signing Review exports XDR instead of creating a Proposal for an unrelated wallet', () => {
  assert.match(signingRoom, /accountSigningReviewOutcome/);
  assert.match(signingRoom, /XDR ready for an authorized signer/);
  assert.match(signingRoom, /will not create a Proposal under an unrelated identity/);
  assert.match(signingRoom, /Copy XDR/);
  assert.match(signingRoom, /Show QR/);
  assert.match(signingRoom, /Choose authorized signer/);
  assert.match(signingRoom, /Continue here instead/);
});

test('external signer can return signed XDR without being forced to submit', () => {
  assert.match(request, /Add a signed XDR manually/);
  assert.match(request, /Copy XDR/);
  assert.match(request, />Not now<\/button>/);
  assert.match(request, /Submit transaction/);
});

test('generic account picker does not leak Treasury language into standalone account signing', () => {
  const picker = source('../SigningAccountPicker.tsx');
  assert.match(picker, /sharedControlOnly \? 'Choose a treasury' : 'Choose an account'/);
  assert.match(picker, /'Your current wallet is an active signer for this account.'/);
  assert.match(picker, /'Use detected account'/);
  assert.match(picker, /'Choose from detected accounts'/);
});

test('a fully signed imported Classic XDR can submit without entering wallet authentication', () => {
  assert.match(signingRoom, /Ready to submit/);
  assert.match(signingRoom, /No additional wallet signature or Proposal is required/);
  assert.match(signingRoom, /submitTransactionXdr\(effectiveXdr, network\)/);
  assert.match(signingRoom, /directSubmitReady/);
  assert.match(signingRoom, /Selected hardware wallet/);
  assert.match(signingRoom, /Choose another/);
});

test('offline handoff accepts a returned signed XDR without restarting Import XDR', () => {
  assert.match(signingRoom, /Add signed XDR/);
  assert.match(signingRoom, /Signed XDR returned by a signer/);
  assert.match(signingRoom, /mergeSignedTransactionXdr\(roomXdr, returnedSignedXdr, network\)/);
  assert.match(signingRoom, /You do not need to leave and start again from Import XDR/);
});
