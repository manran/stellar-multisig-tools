import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../../../web/src/TestnetIntegrationApp.tsx', import.meta.url), 'utf8');
const wizard = readFileSync(new URL('../../../web/src/IntegrationProfileWizard.tsx', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../../web/src/workspaceRoutes.ts', import.meta.url), 'utf8');

test('Testnet Integration self-service reuses the existing Integration wizard without mia credential', () => {
  assert.match(app, /Create Testnet Integration/);
  assert.match(app, /createEndpoint="\/api\/integration-testnet"/);
  assert.match(app, /No application or approval is required/);
  assert.match(app, /API credential — shown once/);
  assert.match(app, /Testnet-only/);
  assert.doesNotMatch(app, /mia_/);
  assert.match(wizard, /createEndpoint = '\/api\/integration-admin'/);
  assert.match(wizard, /adminSecret\?\.trim\(\)/);
  assert.match(routes, /\/developers\/integrations\/new/);
});
