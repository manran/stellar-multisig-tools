import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const treasury = source('../TreasuryApp.tsx');
const designer = source('../MultisigDesignerApp.tsx');
const existingEditor = source('../ExistingMultisigPolicyEditor.tsx');
const review = source('../ReviewTransactionSummary.tsx');
const guidance = source('../SigningGuidance.tsx');
const authorizationResults = source('../TransactionAuthorizationResults.tsx');
const designerModel = source('./multisigDesigner.ts');

test('Treasury signing policy defaults to Human authorization language', () => {
  assert.match(treasury, /Limited account actions/);
  assert.match(treasury, /Standard transactions/);
  assert.match(treasury, /Core account control/);
  assert.match(treasury, /Account key/);
  assert.match(treasury, /humanAuthorizationRequirement/);
  assert.match(treasury, /Total approval power/);
  assert.doesNotMatch(treasury, />Low threshold</);
  assert.doesNotMatch(treasury, /Medium threshold ·/);
  assert.doesNotMatch(treasury, /High threshold ·/);
  assert.doesNotMatch(treasury, />Master key</);
  assert.doesNotMatch(treasury, />weight \{signer\.weight\}/);
  assert.doesNotMatch(treasury, /account\.thresholds\.medium\} \/ \{analysis\.totalActiveWeight/);
  assert.doesNotMatch(treasury, /account\.thresholds\.high\} \/ \{analysis\.totalActiveWeight/);
  assert.doesNotMatch(treasury, /Unlock private data|active ed25519|signer relationships/);
  assert.match(treasury, /Show private details/);
  assert.match(treasury, /public Stellar account data/);
  assert.match(treasury, /signing authority for that Treasury/);
});

test('account-control Prepare and Review keep raw Stellar fields subordinate', () => {
  assert.match(designer, /humanAuthorizationRequirement\(targetAnalysis\.thresholds\.medium\)/);
  assert.match(designer, /humanAuthorizationRequirement\(targetAnalysis\.thresholds\.high\)/);
  assert.match(designer, /Technical Stellar details/);
  assert.match(existingEditor, /Account key/);
  assert.match(existingEditor, /Standard transactions/);
  assert.match(existingEditor, /Core account control/);
  assert.doesNotMatch(existingEditor, /Account master key|Changing thresholds|Disabling the master key|XDR is created/);
});

test('guided policy incompatibility reasons stay in Human authorization language', () => {
  assert.match(designerModel, /account key is currently disabled/);
  assert.match(designerModel, /custom approval power/);
  assert.match(designerModel, /different authorization rules for limited account actions and standard transactions/);
  assert.match(designerModel, /standard signing keys/);
  assert.doesNotMatch(designerModel, /The current master key is disabled|The master weight .*current high threshold|custom signer weights|active ed25519 signers are required|Advanced XDR for changes/);
});

test('signing and authorization surfaces express weighted policies as approval power', () => {
  assert.match(review, /Core account control · \{accountControlReview\.currentHighRequirement\.requirementLabel\}/);
  assert.doesNotMatch(review, /High threshold \{accountControlReview\.currentHighRequirement\.threshold\}/);
  assert.match(guidance, /Core account control · \{humanAuthorizationRequirement\(policy\)\}/);
  assert.doesNotMatch(guidance, /High threshold \{policy\.threshold\}/);
  assert.match(authorizationResults, /Required approval power/);
  assert.match(authorizationResults, /more approval power/);
});
