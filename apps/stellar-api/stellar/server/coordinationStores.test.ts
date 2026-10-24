import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { SigningRequestStore } from './requestStore.js';
import type { SorobanIntentStore } from './sorobanIntentStore.js';
import { blobSigningRequestStore } from './blobRequestStore.js';
import { blobSorobanIntentStore } from './blobSorobanIntentStore.js';
import {
  CoordinationStorageConfigurationError,
  coordinationStorageMode,
  runtimeSigningRequestStore,
  runtimeSorobanIntentStore,
  withSigningRequestCreate,
  withSorobanIntentCreate,
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

test('create wrappers preserve class-store method binding instead of spreading prototype methods away', async () => {
  class RequestClassStore {
    readonly calls: string[] = [];
    async createRequest() { this.calls.push('original-create'); }
    async listContributions() { this.calls.push('bound-request-method'); return []; }
  }
  const requestBase = new RequestClassStore();
  const requestStore = withSigningRequestCreate(
    requestBase as unknown as SigningRequestStore,
    async () => { requestBase.calls.push('replacement-create'); },
  );
  await requestStore.listContributions('REQ');
  await requestStore.createRequest({} as never);
  assert.deepEqual(requestBase.calls, ['bound-request-method', 'replacement-create']);

  class IntentClassStore {
    readonly calls: string[] = [];
    async createIntent() { this.calls.push('original-create'); }
    async listContributions() { this.calls.push('bound-intent-method'); return []; }
  }
  const intentBase = new IntentClassStore();
  const intentStore = withSorobanIntentCreate(
    intentBase as unknown as SorobanIntentStore,
    async () => { intentBase.calls.push('replacement-create'); },
  );
  await intentStore.listContributions('INT');
  await intentStore.createIntent({} as never);
  assert.deepEqual(intentBase.calls, ['bound-intent-method', 'replacement-create']);
});

test('coordination-facing routes select runtime stores instead of hardcoding Blob persistence', () => {
  for (const name of ['request', 'intent', 'inbox', 'activity']) {
    const source = readFileSync(new URL(`../routes/${name}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /blobSigningRequestStore|blobSorobanIntentStore/, `${name} must not hardcode coordination Blob stores`);
    assert.match(source, /runtime(?:SigningRequest|SorobanIntent)Store/, `${name} must select runtime coordination storage`);
  }
});
