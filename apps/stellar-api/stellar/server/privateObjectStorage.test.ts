import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { del, get, list, put } from './privateObjectStorage.js';

async function withFilesystemStore(run: (root: string) => Promise<void>): Promise<void> {
  const previousMode = process.env.MULTISIG_PRIVATE_OBJECT_STORAGE;
  const previousRoot = process.env.MULTISIG_PRIVATE_OBJECT_ROOT;
  const root = await mkdtemp(path.join(os.tmpdir(), 'mst-private-store-'));
  process.env.MULTISIG_PRIVATE_OBJECT_STORAGE = 'filesystem';
  process.env.MULTISIG_PRIVATE_OBJECT_ROOT = root;
  try {
    await run(root);
  } finally {
    if (previousMode === undefined) delete process.env.MULTISIG_PRIVATE_OBJECT_STORAGE;
    else process.env.MULTISIG_PRIVATE_OBJECT_STORAGE = previousMode;
    if (previousRoot === undefined) delete process.env.MULTISIG_PRIVATE_OBJECT_ROOT;
    else process.env.MULTISIG_PRIVATE_OBJECT_ROOT = previousRoot;
  }
}

test('filesystem private object storage supports atomic put/get/list/delete', async () => {
  await withFilesystemStore(async (root) => {
    await put('auth/server-key.json', '{"k":1}', { access: 'private', addRandomSuffix: false });
    await put('requests/a/private-note/2.json', '{"n":2}', { access: 'private', addRandomSuffix: false });
    await put('requests/a/private-note/1.json', '{"n":1}', { access: 'private', addRandomSuffix: false });

    assert.equal(await readFile(path.join(root, 'auth/server-key.json'), 'utf8'), '{"k":1}');

    const stored = await get('auth/server-key.json', { access: 'private', useCache: false });
    assert.equal(stored?.statusCode, 200);
    assert.equal(await new Response(stored?.stream).text(), '{"k":1}');

    const first = await list({ prefix: 'requests/a/private-note/', limit: 1 });
    assert.deepEqual(first.blobs.map((blob) => blob.pathname), ['requests/a/private-note/1.json']);
    assert.equal(first.cursor, '1');

    const second = await list({ prefix: 'requests/a/private-note/', limit: 1, cursor: first.cursor });
    assert.deepEqual(second.blobs.map((blob) => blob.pathname), ['requests/a/private-note/2.json']);
    assert.equal(second.cursor, undefined);

    await del('auth/server-key.json');
    assert.equal(await get('auth/server-key.json', { access: 'private', useCache: false }), null);
  });
});

test('filesystem private object storage rejects traversal', async () => {
  await withFilesystemStore(async () => {
    await assert.rejects(() => put('../escape.json', '{}', { access: 'private', addRandomSuffix: false }));
    await assert.rejects(() => list({ prefix: '../' }));
  });
});
