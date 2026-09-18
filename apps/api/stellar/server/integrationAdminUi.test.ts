import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ui = readFileSync(new URL('../../../../src/IntegrationAdminApp.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../../../../src/main.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../../../../src/StellarWorkspaceShell.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../routes/integration-admin.ts', import.meta.url), 'utf8');

test('Integration admin is an unlinked operator-only runtime surface', () => {
  assert.match(main, /IntegrationAdminApp/);
  assert.match(main, /integration-admin/);
  assert.doesNotMatch(shell, /admin\/integrations|Integration administration/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
  assert.match(ui, /shown once/);
  assert.match(ui, /Rotate msi key/);
  assert.match(ui, /Default Soroban executor/);
});

test('Integration admin API requires the independent operator bearer secret', () => {
  assert.match(api, /authenticateIntegrationAdminSecret/);
  assert.match(api, /Authorization|authorization/);
  assert.match(api, /configure_webhook/);
  assert.match(api, /rotate_webhook_secret/);
  assert.match(api, /configureIntegrationAdminWebhook/);
  assert.match(api, /rotateIntegrationAdminWebhookSecret/);
  assert.doesNotMatch(api, /publicCors/);
});
