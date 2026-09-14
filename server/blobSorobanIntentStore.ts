import { get, put } from '@vercel/blob';
import { withBlobStorage } from './blobRequestStore.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

function intentPath(id: string): string {
  return `intents/${id}/intent.json`;
}

async function readJson<T>(pathname: string): Promise<T | null> {
  return withBlobStorage(async () => {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as T;
  });
}

export const blobSorobanIntentStore: SorobanIntentStore = {
  async createIntent(value) {
    await withBlobStorage(async () => {
      await put(intentPath(value.id), JSON.stringify(value), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
  },
  getIntent(id) {
    return readJson<StoredSorobanIntent>(intentPath(id));
  },

  async updateIntent(value) {
    await withBlobStorage(async () => {
      await put(intentPath(value.id), JSON.stringify(value), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
  },
};
