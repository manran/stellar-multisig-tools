import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobError } from '@vercel/blob';
import { RequestStorageUnavailableError, withBlobStorage } from './blobRequestStore.js';

test('Blob storage delegates credential resolution to the Blob SDK', async () => {
  let called = false;
  const result = await withBlobStorage(async () => {
    called = true;
    return 'resolved-by-sdk';
  });

  assert.equal(called, true);
  assert.equal(result, 'resolved-by-sdk');
});

test('Blob storage maps an actual missing-credentials SDK error to storage_not_configured', async () => {
  await assert.rejects(
    withBlobStorage(async () => {
      throw new BlobError('No blob credentials found.');
    }),
    RequestStorageUnavailableError,
  );
});

test('Blob storage preserves unrelated SDK/application failures', async () => {
  const cause = new Error('temporary upstream failure');
  await assert.rejects(
    withBlobStorage(async () => {
      throw cause;
    }),
    (error: unknown) => error === cause,
  );
});
