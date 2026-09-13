import { createHash } from 'node:crypto';
import { del, get, list, put } from '@vercel/blob';
import type { AddressAliasSubjectType, AddressBookStore, StoredAddressAlias } from './addressBookStore.js';
import { withBlobStorage } from './blobRequestStore.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function ownerPrefix(ownerAddress: string): string {
  return `address-book/${digest(ownerAddress)}/`;
}

function entryPath(ownerAddress: string, subjectType: AddressAliasSubjectType, address: string): string {
  return `${ownerPrefix(ownerAddress)}${subjectType}/${digest(address)}.json`;
}

async function readJson<T>(pathname: string): Promise<T | null> {
  return withBlobStorage(async () => {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as T;
  });
}

export const blobAddressBookStore: AddressBookStore = {
  async list(ownerAddress) {
    return withBlobStorage(async () => {
      const entries: StoredAddressAlias[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: ownerPrefix(ownerAddress), limit: 100, cursor });
        for (const blob of page.blobs) {
          if (!blob.pathname.endsWith('.json')) continue;
          const entry = await readJson<StoredAddressAlias>(blob.pathname);
          if (entry?.version === 1) entries.push(entry);
        }
        cursor = page.cursor;
      } while (cursor);
      return entries;
    });
  },

  get(ownerAddress, subjectType, address) {
    return readJson<StoredAddressAlias>(entryPath(ownerAddress, subjectType, address));
  },

  async put(ownerAddress, entry) {
    await withBlobStorage(async () => {
      await put(entryPath(ownerAddress, entry.subjectType, entry.address), JSON.stringify(entry), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
  },

  async delete(ownerAddress, subjectType, address) {
    await withBlobStorage(async () => {
      await del(entryPath(ownerAddress, subjectType, address));
    });
  },
};
