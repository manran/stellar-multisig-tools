import assert from 'node:assert/strict';
import test from 'node:test';
import { blobSigningRequestStore } from './blobRequestStore.js';
import { blobSorobanIntentStore } from './blobSorobanIntentStore.js';
import {
  CoordinationStorageConfigurationError,
  coordinationStorageMode,
  runtimeSigningRequestStore,
  runtimeSorobanIntentStore,
} from './coordinationStores.js';

test('coordination persistence stays Blob by default until deployment explicitly opts into PostgreSQL', () => {
  assert.equal(coordinationStorageMode(undefined), 'blob');
  assert.equal(coordinationStorageMode(' blob '), 'blob');
  assert.equal(runtimeSigningRequestStore('blob'), blobSigningRequestStore);
  assert.equal(runtimeSorobanIntentStore('blob'), blobSorobanIntentStore);
});

test('PostgreSQL persistence requires one explicit deployment setting', () => {
  assert.equal(coordinationStorageMode('POSTGRES'), 'postgres');
  assert.throws(
    () => coordinationStorageMode('dual-write'),
    CoordinationStorageConfigurationError,
  );
});
