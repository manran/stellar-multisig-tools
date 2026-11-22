import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { accountDisplayName } from '../accountDisplayName.js';

const headerAccount = readFileSync(new URL('../StellarAccountControl.tsx', import.meta.url), 'utf8');
const accountPage = readFileSync(new URL('../IdentityApp.tsx', import.meta.url), 'utf8');

test('account uses a stable nickname until the user names it', () => {
  const id = '94b2acdf-0000-4000-8000-000000000000';
  assert.equal(accountDisplayName(id), 'MST-94B2AC');
  assert.equal(accountDisplayName(id, ' Payroll team '), 'Payroll team');
  assert.match(accountPage, /Edit nickname/);
  assert.match(accountPage, /Copy ID/);
});

test('header opens unified account entry instead of wallet-only sign-in', () => {
  assert.match(headerAccount, /href=\{stellarHref\('\/identity'\)\}/);
  assert.match(headerAccount, /Sign in \/ Sign up/);
  assert.match(headerAccount, /identity \? accountDisplayName\(identity.userId, profile\?\.nickname\) : 'Sign in \/ Sign up'/);
  assert.doesNotMatch(headerAccount, /onClick=\{\(\) => void signIn\(\)\}/);
  assert.match(headerAccount, /WORKSPACE_COPY.identity.accountMethods/);
});

test('Activity switches by verified wallet capability, not the login method', () => {
  const route = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
  const accountActivity = readFileSync(new URL('../UserActivityApp.tsx', import.meta.url), 'utf8');
  const walletActivity = readFileSync(new URL('../ActivityApp.tsx', import.meta.url), 'utf8');
  const switcher = route.slice(route.indexOf('function ActivitySwitch()'), route.indexOf('function RoutedApp()'));
  assert.match(switcher, /const hasWallet = Boolean\(identity\?\.address\)/);
  assert.match(switcher, /stellarActivityScopeForPath\(window\.location\.pathname\) === 'treasury'/);
  assert.doesNotMatch(switcher, /identity\?\.method/);
  assert.match(switcher, /Activity views/);
  assert.match(accountActivity, /verifiedWallet \? privateSessionAddressHeaders\(verifiedWallet\) : \{\}/);
  assert.match(walletActivity, /\{!isTreasuryActivity && navigation\}/);
});

test('account linking never treats an old wallet proof as a newly selected wallet', () => {
  assert.match(accountPage, /walletVerified = Boolean\(privateUnlocked && address && address === unlockedAddress && unlockedNetwork === network\)/);
  assert.match(accountPage, /walletHeaders = walletVerified \? privateSessionAddressHeaders\(unlockedAddress\) : \{\}/);
});

test('one account entry offers Passkey creation and wallet login', () => {
  assert.match(accountPage, /WORKSPACE_COPY.identity.createPasskey/);
  assert.match(accountPage, /WORKSPACE_COPY.identity.signInPasskey/);
  assert.match(accountPage, /WORKSPACE_COPY.identity.signInWallet/);
  assert.match(accountPage, /WORKSPACE_COPY.identity.addPasskey/);
});
