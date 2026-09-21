import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const developerDocs = readFileSync(new URL('../DeveloperDocs.tsx', import.meta.url), 'utf8');
const developerExamples = readFileSync(new URL('./developerDocsExamples.ts', import.meta.url), 'utf8');
const docsArchitecture = readFileSync(new URL('../../DOCS_INFORMATION_ARCHITECTURE.md', import.meta.url), 'utf8');
const integrationModel = readFileSync(new URL('../../apps/internal-docs/content/stellar/architecture/integration-product-model.md', import.meta.url), 'utf8');
const integrationWizard = readFileSync(new URL('../IntegrationProfileWizard.tsx', import.meta.url), 'utf8');
const intentRoute = readFileSync(new URL('../../apps/api/stellar/routes/intent.ts', import.meta.url), 'utf8');
const requestService = readFileSync(new URL('../../apps/api/stellar/server/integrationRequestService.ts', import.meta.url), 'utf8');

test('Developer Hub starts from integration ownership instead of endpoint inventory', () => {
  assert.match(developerDocs, /title="Choose your integration"/);
  assert.match(developerDocs, />Hosted</);
  assert.match(developerDocs, />On my site</);
  assert.match(developerDocs, />Full Headless</);
  assert.match(developerDocs, /You take over orchestration, not authority/);
  assert.match(developerDocs, /Testnet Integration is self-service/);
  assert.match(developerDocs, /No application or approval is required on Testnet/);
  assert.match(developerDocs, /\/developers\/integrations\/new/);
  assert.match(docsArchitecture, /\/developers -> \/docs\/developers/);
  assert.match(docsArchitecture, /\/docs\/automation.*canonical Agent API page/s);
});

test('Native Browser documentation stays Soroban Intent scoped to the shipped capability', () => {
  assert.match(developerDocs, /Native Browser authorization is currently Intent\/Soroban-scoped/);
  assert.match(developerExamples, /issue_browser_authorization/);
  assert.match(developerExamples, /X-MultiSig-Intent-Capability/);
  assert.match(intentRoute, /body\.action === 'issue_browser_authorization'/);
  assert.match(intentRoute, /browser_capability_write_denied/);
  assert.match(intentRoute, /Integration credentials cannot contribute Soroban signer authorization/);
});

test('Classic developer docs keep execution mechanics separate from Treasury signer authority', () => {
  assert.match(developerDocs, /Treasury signer authority stays on Stellar/);
  assert.match(developerDocs, /Managed by default when the deployment can support it/);
  assert.match(developerDocs, /Manage execution myself/);
  assert.match(integrationWizard, /executionOwner: 'multisigtools'/);
  assert.match(integrationWizard, /Manage execution myself/);
  assert.match(requestService, /executionMode = integrationClassicExecutionMode/);
  assert.match(integrationModel, /Execution ownership is configured independently from signer authorization/);
});

test('Developer API guidance treats webhook as notification over canonical state', () => {
  assert.match(developerDocs, /The webhook is not the source of truth/);
  assert.match(developerDocs, /deduplicate event id → GET canonical Request\/Intent\/Job/);
  assert.match(developerDocs, /Branch on stable error codes, not message text/);
  assert.match(developerExamples, /standardwebhooks/);
  assert.match(developerExamples, /webhook-signature/);
  assert.match(integrationModel, /durable outbox and delivery records/);
});

test('Testnet quickstart is a bounded Classic Hosted path from credential to canonical status', () => {
  assert.match(developerDocs, /Start by creating the Testnet profile/);
  assert.match(developerDocs, /Store the returned credential/);
  assert.match(developerDocs, /Create one semantic Classic Request/);
  assert.match(developerDocs, /Read the Request id and execution mode/);
  assert.match(developerDocs, /Open the Hosted signer review/);
  assert.match(developerDocs, /Read canonical status after signing/);
  assert.match(developerExamples, /testnetIntegrationCreateExample/);
  assert.match(developerExamples, /classicHostedReviewExample/);
  assert.match(developerExamples, /classicStatusExample/);
});

test('Agent documentation points to signer self-service credential issuance', () => {
  assert.match(developerDocs, /Create the Agent credential from the signer account/);
  assert.match(developerDocs, /stellarHref\('\/agent-access'\)/);
  assert.match(developerDocs, /msa_\*/);
  assert.match(developerDocs, /Agent Request creation currently uses exact transaction XDR/);
});

test('Developer sections avoid decorative eyebrow repetition', () => {
  assert.equal(developerDocs.match(/mst-doc-eyebrow/g)?.length, 1);
});
