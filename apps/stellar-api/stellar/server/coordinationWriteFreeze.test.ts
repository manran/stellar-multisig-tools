import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as requestPost } from '../routes/request.js';
import { POST as intentPost } from '../routes/intent.js';
import {
  assertCoordinationWritesEnabled,
  CoordinationWriteFrozenError,
} from './coordinationWriteFreeze.js';

test('coordination write freeze is opt-in and exposes one stable migration error', () => {
  assert.doesNotThrow(() => assertCoordinationWritesEnabled(undefined));
  assert.doesNotThrow(() => assertCoordinationWritesEnabled('0'));
  assert.throws(
    () => assertCoordinationWritesEnabled('1'),
    (cause: unknown) => cause instanceof CoordinationWriteFrozenError
      && cause.code === 'coordination_write_frozen'
      && cause.status === 503,
  );
});

test('Request and Intent mutation routes fail before authentication/body/storage while migration freeze is active', async () => {
  const previous = process.env.MULTISIG_COORDINATION_WRITE_FREEZE;
  process.env.MULTISIG_COORDINATION_WRITE_FREEZE = '1';
  try {
    for (const response of await Promise.all([
      requestPost(new Request('https://stellar-testnet.multisig.tools/api/request', { method: 'POST' })),
      intentPost(new Request('https://stellar-testnet.multisig.tools/api/intent', { method: 'POST' })),
    ])) {
      assert.equal(response.status, 503);
      const body = await response.json() as { code?: string };
      assert.equal(body.code, 'coordination_write_frozen');
    }
  } finally {
    if (previous === undefined) delete process.env.MULTISIG_COORDINATION_WRITE_FREEZE;
    else process.env.MULTISIG_COORDINATION_WRITE_FREEZE = previous;
  }
});
