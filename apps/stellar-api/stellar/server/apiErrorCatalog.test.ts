import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createOpenApiDocument } from './openApiDocument.js';
import { API_ERROR_CATALOG } from './apiErrorCatalog.generated.js';

test('published API error catalog is synchronized with the statically declared API codes', () => {
  execFileSync(process.execPath, ['scripts/generateApiErrorCatalog.mjs', '--check'], { cwd: new URL('../../../../', import.meta.url) });
  assert.deepEqual(createOpenApiDocument()['x-multisig-errors'], API_ERROR_CATALOG);
  assert.ok(Object.keys(API_ERROR_CATALOG).length > 81);
  assert.deepEqual(API_ERROR_CATALOG.unknown_request_field.statuses, [400]);
  assert.ok(API_ERROR_CATALOG.intent_execution_outcome_unknown.statuses.includes(409));
  assert.match(API_ERROR_CATALOG.idempotency_conflict.callerAction, /Stop/);
});
