import { get, list, put } from '@vercel/blob';
import type { PrivateNoteRevision } from '../../../../src/stellar/privateNote.js';
import { withBlobStorage } from './blobRequestStore.js';
import type {
  RequestPrivateDataStore,
  StoredRequestPrivateData,
} from './requestPrivateDataStore.js';

function rootPath(id: string): string {
  return `private-context/v1/classic-requests/${encodeURIComponent(id)}/initial.json`;
}

function notePrefix(id: string): string {
  return `private-context/v1/classic-requests/${encodeURIComponent(id)}/notes/`;
}

function notePath(id: string, revisionId: string): string {
  return `${notePrefix(id)}${encodeURIComponent(revisionId)}.json`;
}

async function readJson<T>(pathname: string): Promise<T | null> {
  return withBlobStorage(async () => {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as T;
  });
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const blobRequestPrivateDataStore: RequestPrivateDataStore = {
  getRequestPrivateData(id) {
    return readJson(rootPath(id));
  },

  async putRequestPrivateData(id, value) {
    const existing = await readJson<StoredRequestPrivateData>(rootPath(id));
    if (existing) {
      if (same(existing, value)) return;
      throw new Error('Signing Request private context already exists with different content.');
    }
    try {
      await withBlobStorage(async () => {
        await put(rootPath(id), JSON.stringify(value), {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
        });
      });
    } catch (cause) {
      const raced = await readJson<StoredRequestPrivateData>(rootPath(id));
      if (raced && same(raced, value)) return;
      throw cause;
    }
  },

  async listPrivateNoteRevisions(id) {
    return withBlobStorage(async () => {
      const values: PrivateNoteRevision[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: notePrefix(id), limit: 100, cursor });
        for (const blob of page.blobs) {
          const value = await readJson<PrivateNoteRevision>(blob.pathname);
          if (value) values.push(value);
        }
        cursor = page.cursor;
      } while (cursor);
      return values.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.revisionId.localeCompare(b.revisionId));
    });
  },

  async putPrivateNoteRevision(id, value) {
    const pathname = notePath(id, value.revisionId);
    const existing = await readJson<PrivateNoteRevision>(pathname);
    if (existing) {
      if (same(existing, value)) return;
      throw new Error('Private note revision already exists with different content.');
    }
    try {
      await withBlobStorage(async () => {
        await put(pathname, JSON.stringify(value), {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
        });
      });
    } catch (cause) {
      const raced = await readJson<PrivateNoteRevision>(pathname);
      if (raced && same(raced, value)) return;
      throw cause;
    }
  },
};
