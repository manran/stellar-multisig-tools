import { get, put } from './privateObjectStorage.js';
import { withBlobStorage } from './blobRequestStore.js';
import type {
  SorobanIntentPrivateDataStore,
  StoredSorobanIntentPrivateData,
} from './sorobanIntentPrivateDataStore.js';

function pathFor(id: string): string {
  return `private-context/v1/soroban-intents/${encodeURIComponent(id)}.json`;
}

async function read(id: string): Promise<StoredSorobanIntentPrivateData | null> {
  return withBlobStorage(async () => {
    const result = await get(pathFor(id), { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as StoredSorobanIntentPrivateData;
  });
}

function same(
  left: StoredSorobanIntentPrivateData,
  right: StoredSorobanIntentPrivateData,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const blobSorobanIntentPrivateDataStore: SorobanIntentPrivateDataStore = {
  getIntentPrivateData(id) {
    return read(id);
  },

  async putIntentPrivateData(id, value) {
    const existing = await read(id);
    if (existing) {
      if (same(existing, value)) return;
      throw new Error('Soroban Intent private context already exists with different content.');
    }
    try {
      await withBlobStorage(async () => {
        await put(pathFor(id), JSON.stringify(value), {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
        });
      });
    } catch (cause) {
      const raced = await read(id);
      if (raced && same(raced, value)) return;
      throw cause;
    }
  },
};
