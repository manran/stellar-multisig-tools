import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const headerAccount = readFileSync(new URL('../StellarAccountControl.tsx', import.meta.url), 'utf8');
const accountPage = readFileSync(new URL('../IdentityApp.tsx', import.meta.url), 'utf8');

test('header opens unified account entry instead of wallet-only sign-in', () => {
  assert.match(headerAccount, /href=\{stellarHref\('\/identity'\)\}/);
  assert.match(headerAccount, /Sign in \/ Sign up/);
  assert.match(headerAccount, /\{identity \? 'Your account' : 'Sign in \/ Sign up'\}/);
  assert.doesNotMatch(headerAccount, /onClick=\{\(\) => void signIn\(\)\}/);
  assert.match(headerAccount, /Account and login methods/);
});

test('one account entry offers Passkey creation and wallet login', () => {
  assert.match(accountPage, /Create Passkey account/);
  assert.match(accountPage, /Sign in with Passkey/);
  assert.match(accountPage, /Sign in with Stellar wallet/);
  assert.match(accountPage, /Add Passkey/);
});
