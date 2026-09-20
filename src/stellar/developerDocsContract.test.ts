import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const developerDocs = readFileSync(new URL('../DeveloperDocs.tsx', import.meta.url), 'utf8');
const docsArchitecture = readFileSync(new URL('../../DOCS_INFORMATION_ARCHITECTURE.md', import.meta.url), 'utf8');
const integrationModel = readFileSync(new URL('../../INTEGRATION_PRODUCT_MODEL.md', import.meta.url), 'utf8');
const integrationWizard = readFileSync(new URL('../IntegrationProfileWizard.tsx', import.meta.url), 'utf8');
const intentRoute = readFileSync(new URL('../../apps/api/stellar/routes/intent.ts', import.meta.url), 'utf8');
const requestService = readFileSync(new URL('../../apps/api/stellar/server/integrationRequestService.ts', import.meta.url), 'utf8');

test('Developer Hub starts from integration ownership instead of endpoint inventory', () => {
  assert.match(developerDocs, /title="Choose your integration"/);
  assert.match(developerDocs, />Hosted</);
  assert.match(developerDocs, />On my site</);
  assert.match(developerDocs, />Full Headless</);
  assert.match(developerDocs, /You take over orchestration, not authority/);
  assert.match(docsArchitecture, /\/developers -> \/docs\/developers/);
  assert.match(docsArchitecture, /\/docs\/automation.*canonical Agent API page/s);
});

test('Native Browser documentation stays Soroban Intent scoped to the shipped capability', () => {
  assert.match(developerDocs, /Native Browser authorization is currently Intent\/Soroban-scoped/);
  assert.match(developerDocs, /issue_browser_authorization/);
  assert.match(developerDocs, /X-MultiSig-Intent-Capability/);
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
  assert.match(developerDocs, /Webhook is a notification, not the source of truth/);
  assert.match(developerDocs, /Receive → deduplicate event id → GET canonical Request\/Intent\/Job/);
  assert.match(integrationModel, /durable outbox and delivery records/);
});
