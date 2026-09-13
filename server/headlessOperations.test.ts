import assert from 'node:assert/strict';
import test from 'node:test';
import { HEADLESS_OPERATION_CATALOG } from '../src/stellar/headlessOperations.js';

test('headless operation ids are unique and explicitly versioned', () => {
  const ids = HEADLESS_OPERATION_CATALOG.map((operation) => operation.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(HEADLESS_OPERATION_CATALOG.every((operation) => operation.version === 1));
});

test('runtime policy and contract vertical slice are available to every transport consumer', () => {
  const byId = new Map(HEADLESS_OPERATION_CATALOG.map((operation) => [operation.id, operation]));
  assert.equal(byId.get('runtime.config.inspect')?.path, '/api/runtime-config');
  assert.equal(byId.get('runtime.config.inspect')?.access, 'public');
  assert.equal(byId.get('contract.interface.inspect')?.access, 'public');
  assert.equal(byId.get('contract.call.build')?.effect, 'none');
  assert.equal(byId.get('contract.call.prepare')?.path, '/api/contract-prepare');
  assert.equal(byId.get('contract.authorization.create')?.access, 'principal:write');
  assert.equal(byId.get('contract.authorization.inspect')?.access, 'principal:read');
  assert.equal(byId.get('contract.authorization.contribute')?.access, 'principal:sign');
  assert.equal(byId.get('contract.authorization.freeze')?.effect, 'coordination-state');
  assert.equal(byId.get('contract.workspace.list')?.access, 'principal:read');
  assert.equal(byId.get('contract.workspace.keep')?.access, 'principal:write');
  assert.equal(byId.get('contract.workspace.forget')?.path, '/api/contracts');
});
