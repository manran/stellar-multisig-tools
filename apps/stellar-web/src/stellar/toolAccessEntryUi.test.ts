import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TOOL_PATHS, toolReturnPath } from './toolAccessRouting';

function source(name: string) {
  return readFileSync(new URL('../' + name, import.meta.url), 'utf8');
}

test('all four Tools reuse the same entry instead of inline wallet prompts', () => {
  for (const [file, route] of [
    ['ContractsApp.tsx', '/contracts'],
    ['TreasuryApp.tsx', '/treasury'],
    ['AddressBookApp.tsx', '/address-book'],
    ['AgentAccessApp.tsx', '/agent-access'],
  ]) {
    const page = source(file);
    assert.match(page, new RegExp('<ToolAccessEntry returnTo="' + route + '"'));
    assert.doesNotMatch(page, /Connect the signer workspace|Connect the signer<|<h2[^>]*>Connect a wallet/);
    assert.doesNotMatch(page, /onClick=\{\(\) => void connect\(\)\}/);
  }
});

test('the entry separates MST login from signer-wallet verification', () => {
  const entry = source('ToolAccessEntry.tsx');
  assert.match(entry, /identity \? \(/);
  assert.match(entry, /Sign in \/ Sign up/);
  assert.match(entry, /Connect Stellar wallet/);
  assert.match(entry, /stellarHrefWithSearch\('\/identity', \{ next: returnTo \}\)/);
  assert.match(entry, /await unlock\(\)/);
  assert.match(source('PrivateWorkspaceUnlock.tsx'), /unlockAndContinue/);
});

test('only four canonical Tool paths are accepted as post-login destinations', () => {
  assert.equal(TOOL_PATHS.length, 4);
  for (const path of TOOL_PATHS) assert.equal(toolReturnPath(path), path);
  for (const candidate of [null, '', '/', '/inbox', '//example.com', 'https://example.com', '/contracts?x=1', '/contracts#foo', '/%2fcontracts']) {
    assert.equal(toolReturnPath(candidate), null);
  }
});

test('Passkey, registration and Stellar wallet login honor the safe return target', () => {
  const page = source('IdentityApp.tsx');
  assert.match(page, /toolReturnPath\(new URLSearchParams\(window.location.search\).get\('next'\)\)/);
  assert.match(page, /navigateWorkspace\(returnToTool \?\? '\/inbox'\)/);
  assert.match(page, /navigateWorkspace\(returnToTool \?\? '\/'\)/);
  assert.match(page, /if \(inviteToken\) navigateWorkspace\('\/new'\)/);
});
