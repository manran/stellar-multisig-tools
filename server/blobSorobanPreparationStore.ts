import { get, list, put } from '@vercel/blob';
import type { StellarNetwork } from '../src/stellar/types.js';
import { isValidSigningRequestId } from './requestLocator.js';
import { withBlobStorage } from './blobRequestStore.js';
import type {
  SorobanPreparationStore,
  StoredSorobanAuthorizationContribution,
  StoredSorobanPreparation,
  StoredSorobanPreparationFreeze,
} from './sorobanPreparationStore.js';

function preparationPath(id: string) { return `preparations/${id}/preparation.json`; }
function contributionPath(id: string, digest: string) { return `preparations/${id}/authorization/${digest}.json`; }
function freezePath(id: string) { return `preparations/${id}/freeze.json`; }
function signerPrefix(network: StellarNetwork, address: string) { return `preparation-discovery/v1/signers/${network}/${address}/`; }
function signerPath(network: StellarNetwork, address: string, id: string) { return `${signerPrefix(network, address)}${id}.json`; }

async function readJson<T>(pathname: string): Promise<T | null> {
  return withBlobStorage(async () => {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as T;
  });
}

async function requestIdsForSigner(network: StellarNetwork, address: string): Promise<string[]> {
  return withBlobStorage(async () => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: signerPrefix(network, address), limit: 100, cursor });
      for (const blob of page.blobs) {
        const filename = blob.pathname.slice(signerPrefix(network, address).length);
        if (!filename.endsWith('.json')) continue;
        const id = filename.slice(0, -5);
        if (isValidSigningRequestId(id)) ids.push(id);
      }
      cursor = page.cursor;
    } while (cursor);
    return ids;
  });
}

export const blobSorobanPreparationStore: SorobanPreparationStore = {
  async createPreparation(preparation) {
    await withBlobStorage(async () => {
      await Promise.all(preparation.discoverySignerKeys.map((address) => put(
        signerPath(preparation.network, address, preparation.id),
        JSON.stringify({ requestId: preparation.id }),
        { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 },
      )));
      await put(preparationPath(preparation.id), JSON.stringify(preparation), {
        access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json', cacheControlMaxAge: 60,
      });
    });
  },
  getPreparation(id) { return readJson<StoredSorobanPreparation>(preparationPath(id)); },
  async updatePreparation(preparation) {
    await withBlobStorage(async () => {
      await put(preparationPath(preparation.id), JSON.stringify(preparation), {
        access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60,
      });
    });
  },
  async listPreparationsBySigner(network, signerAddress) {
    const ids = await requestIdsForSigner(network, signerAddress);
    const records = await Promise.all(ids.map((id) => readJson<StoredSorobanPreparation>(preparationPath(id))));
    return records.filter((record): record is StoredSorobanPreparation => Boolean(record));
  },
  async listContributions(id) {
    return withBlobStorage(async () => {
      const values: StoredSorobanAuthorizationContribution[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: `preparations/${id}/authorization/`, limit: 100, cursor });
        for (const blob of page.blobs) {
          const value = await readJson<StoredSorobanAuthorizationContribution>(blob.pathname);
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
        access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60,
      });
    });
  },
  getFreeze(id) { return readJson<StoredSorobanPreparationFreeze>(freezePath(id)); },
  async putFreeze(id, freeze) {
    await withBlobStorage(async () => {
      const pathname = freezePath(id);
      const existing = await readJson<StoredSorobanPreparationFreeze>(pathname);
      if (existing) return;
      try {
        await put(pathname, JSON.stringify(freeze), {
          access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json', cacheControlMaxAge: 60,
        });
      } catch (cause) {
        if (await readJson<StoredSorobanPreparationFreeze>(pathname)) return;
        throw cause;
      }
    });
  },
};
