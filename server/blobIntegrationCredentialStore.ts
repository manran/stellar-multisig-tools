import { get, list, put } from '@vercel/blob';
import { withBlobStorage } from './blobRequestStore.js';
import type { IntegrationCredentialStore, StoredIntegrationCredential } from './integrationCredentialStore.js';

const PREFIX = 'integration-credentials/v1/';

function pathFor(serviceId: string): string {
  return `${PREFIX}${encodeURIComponent(serviceId)}.json`;
}

async function readJson(pathname: string): Promise<StoredIntegrationCredential | null> {
  return withBlobStorage(async () => {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as StoredIntegrationCredential;
  });
}

export const blobIntegrationCredentialStore: IntegrationCredentialStore = {
  getCredential(serviceId) {
    return readJson(pathFor(serviceId));
  },
  async listCredentials() {
    return withBlobStorage(async () => {
      const records: StoredIntegrationCredential[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: PREFIX, limit: 100, cursor });
        for (const blob of page.blobs) {
          if (!blob.pathname.endsWith('.json')) continue;
          const record = await readJson(blob.pathname);
          if (record) records.push(record);
        }
        cursor = page.cursor;
      } while (cursor);
      return records.sort((a, b) => a.credential.serviceId.localeCompare(b.credential.serviceId));
    });
  },
  async putCredential(record) {
    await withBlobStorage(async () => {
      await put(pathFor(record.credential.serviceId), JSON.stringify(record), {
        access: 'private', addRandomSuffix: false, allowOverwrite: true,
        contentType: 'application/json', cacheControlMaxAge: 60,
      });
    });
  },
};
