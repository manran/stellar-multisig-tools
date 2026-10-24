import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function doc(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const developerIndex = doc('../../../docs/content/stellar/developers/index.mdx');
const quickstart = doc('../../../docs/content/stellar/developers/testnet-quickstart.mdx');
const classic = doc('../../../docs/content/stellar/developers/classic.mdx');
const soroban = doc('../../../docs/content/stellar/developers/soroban.mdx');
const apiDocs = doc('../../../docs/content/stellar/developers/api.mdx');
const agentDocs = doc('../../../docs/content/stellar/developers/agent-api.mdx');
const docsArchitecture = doc('../../../internal-docs/content/stellar/architecture/documentation-information-architecture.md');
const integrationModel = doc('../../../internal-docs/content/stellar/architecture/integration-product-model.md');
const integrationWizard = doc('../IntegrationProfileWizard.tsx');
const intentRoute = doc('../../../stellar-api/stellar/routes/intent.ts');
const requestService = doc('../../../stellar-api/stellar/server/integrationRequestService.ts');

test('public Developer docs start from integration ownership instead of endpoint inventory', () => {
  assert.match(developerIndex, /title: Choose your integration/);
  assert.match(developerIndex, /## Hosted/);
  assert.match(developerIndex, /## On my site/);
  assert.match(developerIndex, /## Full Headless/);
  assert.match(developerIndex, /You take over orchestration, not authority/);
  assert.match(developerIndex, /No application or approval is required on Testnet/);
  assert.match(docsArchitecture, /https:\/\/docs\.multisig\.tools\/stellar/);
  assert.match(docsArchitecture, /\/stellar\/developers\/agent-api/);
  assert.doesNotMatch(docsArchitecture, /\/developers -> \/docs\/developers/);
});

test('Native Browser documentation stays Soroban Intent scoped to the shipped capability', () => {
  assert.match(developerIndex, /Native Browser authorization is currently Intent\/Soroban-scoped/);
  assert.match(soroban, /short-lived capability bound to one service, Intent, AuthorizationPlan revision\/digest, signer, exact browser origin, and expiry/);
  assert.match(soroban, /cannot create arbitrary Intents, cancel\/replan, change execution ownership/);
  assert.match(intentRoute, /body\.action === 'issue_browser_authorization'/);
  assert.match(intentRoute, /browser_capability_write_denied/);
  assert.match(intentRoute, /Integration credentials cannot contribute Soroban signer authorization/);
});

test('Classic public docs keep execution mechanics separate from Treasury signer authority', () => {
  assert.match(classic, /Treasury signer authority stays on Stellar/);
  assert.match(classic, /Managed Classic/);
  assert.match(classic, /Manage execution myself/);
  assert.match(classic, /never becomes a Treasury signer/);
  assert.match(integrationWizard, /executionOwner: 'multisigtools'/);
  assert.match(integrationWizard, /Manage execution myself/);
  assert.match(requestService, /executionMode = integrationClassicExecutionMode/);
  assert.match(integrationModel, /Execution ownership is configured independently from signer authorization/);
});

test('public API guidance treats webhook as notification over canonical state', () => {
  assert.match(apiDocs, /Webhook:.*GET canonical Request\/Intent\/Job.*act from current state/s);
  assert.match(apiDocs, /Branch on stable error codes, not message text/);
  assert.match(apiDocs, /standardwebhooks/);
  assert.match(apiDocs, /webhook-signature/);
  assert.match(integrationModel, /durable outbox and delivery records/);
});

test('Testnet quickstart is a bounded Classic Hosted path from credential to canonical status', () => {
  assert.match(quickstart, /Create a Testnet Integration Profile/);
  assert.match(quickstart, /one-time `msi_\*` credential/);
  assert.match(quickstart, /Inspect the deployment/);
  assert.match(quickstart, /Create one semantic Classic Request/);
  assert.match(quickstart, /Open Hosted review/);
  assert.match(quickstart, /Read canonical status/);
  assert.match(quickstart, /https:\/\/api-testnet\.multisig\.tools\/stellar/);
});

test('Agent docs keep signer Agent and Treasury Audit credentials distinct', () => {
  assert.match(agentDocs, /Agent credentials are created from the signer account/);
  assert.match(agentDocs, /`msa_\*`/);
  assert.match(agentDocs, /## Treasury Audit credentials/);
  assert.match(agentDocs, /separate from signer Agent credentials/);
  assert.match(agentDocs, /read-only resource credentials/);
  assert.match(agentDocs, /`mta_\*`/);
  assert.match(agentDocs, /cannot access a signer's Inbox or personal contacts, create Requests or Intents, contribute signatures or Soroban AUTH, submit transactions, or manage Treasury settings/);
});
