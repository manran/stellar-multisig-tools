import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get, put } from './privateObjectStorage.js';

test('Filesystem private storage atomically refuses a second create-only write', async () => {
  const originalMode = process.env.MULTISIG_PRIVATE_OBJECT_STORAGE;
  const originalRoot = process.env.MULTISIG_PRIVATE_OBJECT_ROOT;
  const root = await mkdtemp(join(tmpdir(), 'mst-private-atomic-'));
  process.env.MULTISIG_PRIVATE_OBJECT_STORAGE = 'filesystem';
  process.env.MULTISIG_PRIVATE_OBJECT_ROOT = root;
  try {
    const options = { access: 'private' as const, allowOverwrite: false, addRandomSuffix: false };
    const writes = await Promise.allSettled([
      put('agent-grants/example/claimed.json', 'first', options),
      put('agent-grants/example/claimed.json', 'second', options),
    ]);
    assert.equal(writes.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(writes.filter((r) => r.status === 'rejected').length, 1);
    const result = await get('agent-grants/example/claimed.json');
    assert.ok(result?.stream);
    assert.ok(['first', 'second'].includes(await new Response(result.stream).text()));
    await put('agent-grants/example/claimed.json', 'updated', { access: 'private', allowOverwrite: true, addRandomSuffix: false });
    const current = await get('agent-grants/example/claimed.json');
    assert.ok(current?.stream);
    assert.equal(await new Response(current.stream).text(), 'updated');
  } finally {
    if (originalMode === undefined) delete process.env.MULTISIG_PRIVATE_OBJECT_STORAGE;
    else process.env.MULTISIG_PRIVATE_OBJECT_STORAGE = originalMode;
    if (originalRoot === undefined) delete process.env.MULTISIG_PRIVATE_OBJECT_ROOT;
    else process.env.MULTISIG_PRIVATE_OBJECT_ROOT = originalRoot;
    await rm(root, { recursive: true, force: true });
  }
});
