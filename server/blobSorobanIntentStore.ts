import { get, list, put } from '@vercel/blob';
import { withBlobStorage } from './blobRequestStore.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntent,
  StoredSorobanIntentAuthorizationContribution,
} from './sorobanIntentStore.js';

function intentPath(id: string): string {
  return `intents/${id}/intent.json`;
}

function contributionPrefix(id: string): string {
  return `intents/${id}/auth-contributions/`;
}

function contributionPath(id: string, digest: string): string {
  return `${contributionPrefix(id)}${encodeURIComponent(digest)}.json`;
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

  async listContributions(id) {
    return withBlobStorage(async () => {
      const values: StoredSorobanIntentAuthorizationContribution[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: contributionPrefix(id), limit: 100, cursor });
        for (const blob of page.blobs) {
          if (!blob.pathname.endsWith('.json')) continue;
          const value = await readJson<StoredSorobanIntentAuthorizationContribution>(blob.pathname);
          if (value) values.push(value);
        }
        cursor = page.cursor;
      } while (cursor);
      return values.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.digest.localeCompare(b.digest));
    });
  },

  async putContribution(id, contribution) {
    await withBlobStorage(async () => {
      await put(contributionPath(id, contribution.digest), JSON.stringify(contribution), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
  },
};
