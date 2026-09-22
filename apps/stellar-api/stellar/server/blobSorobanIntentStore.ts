import { get, list, put } from '@vercel/blob';
import { withBlobStorage } from './blobRequestStore.js';
import type { SorobanExecutionPolicy } from '../../../../packages/stellar-core/src/executionPolicy.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import { isValidSigningRequestId } from './requestLocator.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntent,
  StoredSorobanIntentAuthorizationContribution,
  StoredSorobanIntentCancellation,
  StoredSorobanIntentExecutionObservation,
  StoredSorobanIntentExecutionPreparation,
} from './sorobanIntentStore.js';

function intentPath(id: string): string {
  return `intents/${id}/intent.json`;
}

function signerPrefix(network: StellarNetwork, address: string): string {
  return `intent-discovery/v1/signers/${network}/${address}/`;
}

function signerPath(network: StellarNetwork, address: string, id: string): string {
  return `${signerPrefix(network, address)}${id}.json`;
}

function executionBindingPath(id: string): string {
  return `intents/${id}/execution-binding.json`;
}

function cancellationPath(id: string): string {
  return `intents/${id}/cancellation.json`;
}

function contributionPrefix(id: string): string {
  return `intents/${id}/auth-contributions/`;
}

function contributionPath(id: string, digest: string): string {
  return `${contributionPrefix(id)}${encodeURIComponent(digest)}.json`;
}

function executionPreparationPrefix(id: string): string {
  return `intents/${id}/execution-preparations/`;
}

function executionPreparationPath(id: string, preparation: StoredSorobanIntentExecutionPreparation): string {
  const timeKey = preparation.preparedAt.replace(/[:.]/g, '-');
  return `${executionPreparationPrefix(id)}${timeKey}-${preparation.transactionHash}.json`;
}

function executionObservationPrefix(id: string): string {
  return `intents/${id}/execution-results/`;
}

function executionObservationPath(id: string, transactionHash: string): string {
  return `${executionObservationPrefix(id)}${transactionHash}.json`;
}

interface StoredExecutionPolicyBinding {
  version: 1;
  executionPolicy: SorobanExecutionPolicy;
}

async function readJson<T>(pathname: string): Promise<T | null> {
  return withBlobStorage(async () => {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as T;
  });
}


async function readIntent(id: string): Promise<StoredSorobanIntent | null> {
  const stored = await readJson<StoredSorobanIntent>(intentPath(id));
  if (!stored) return null;
  const [binding, cancellation] = await Promise.all([
    stored.executionPolicy?.executor
      ? Promise.resolve(null)
      : readJson<StoredExecutionPolicyBinding>(executionBindingPath(id)),
    readJson<StoredSorobanIntentCancellation>(cancellationPath(id)),
  ]);
  return {
    ...stored,
    ...(binding ? { executionPolicy: binding.executionPolicy } : {}),
    ...(cancellation ? { cancellation } : {}),
  };
}

async function intentIdsForSigner(network: StellarNetwork, address: string): Promise<string[]> {
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

export const blobSorobanIntentStore: SorobanIntentStore = {
  async createIntent(value) {
    await withBlobStorage(async () => {
      await Promise.all(value.discoverySignerKeys.map((address) => put(
        signerPath(value.network, address, value.id),
        JSON.stringify({ intentId: value.id }),
        { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 },
      )));
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
    return readIntent(id);
  },

  async updateIntent(value) {
    await withBlobStorage(async () => {
      await Promise.all(value.discoverySignerKeys.map((address) => put(
        signerPath(value.network, address, value.id),
        JSON.stringify({ intentId: value.id }),
        { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 },
      )));
      await put(intentPath(value.id), JSON.stringify(value), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
  },

  async cancelIntent(id, cancellation) {
    const pathname = cancellationPath(id);
    try {
      await withBlobStorage(async () => {
        await put(pathname, JSON.stringify(cancellation), {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
        });
      });
      return { cancellation, created: true };
    } catch (cause) {
      const existing = await readJson<StoredSorobanIntentCancellation>(pathname);
      if (!existing) throw cause;
      return { cancellation: existing, created: false };
    }
  },

  async bindExecutionPolicy(id, executionPolicy) {
    const pathname = executionBindingPath(id);
    const binding: StoredExecutionPolicyBinding = { version: 1, executionPolicy };
    try {
      await withBlobStorage(async () => {
        await put(pathname, JSON.stringify(binding), {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
        });
      });
    } catch (cause) {
      const existing = await readJson<StoredExecutionPolicyBinding>(pathname);
      if (!existing) throw cause;
      return existing.executionPolicy;
    }
    const current = await readJson<StoredSorobanIntent>(intentPath(id));
    if (current) await blobSorobanIntentStore.updateIntent({ ...current, executionPolicy });
    return executionPolicy;
  },

  async listIntentsBySigner(network, signerAddress) {
    const ids = await intentIdsForSigner(network, signerAddress);
    const records = await Promise.all(ids.map((id) => readIntent(id)));
    return records.filter((record): record is StoredSorobanIntent => Boolean(record));
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

  async listExecutionPreparations(id) {
    return withBlobStorage(async () => {
      const values: StoredSorobanIntentExecutionPreparation[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: executionPreparationPrefix(id), limit: 100, cursor });
        for (const blob of page.blobs) {
          if (!blob.pathname.endsWith('.json')) continue;
          const value = await readJson<StoredSorobanIntentExecutionPreparation>(blob.pathname);
          if (value) values.push(value);
        }
        cursor = page.cursor;
      } while (cursor);
      return values.sort((a, b) => a.preparedAt.localeCompare(b.preparedAt) || a.transactionHash.localeCompare(b.transactionHash));
    });
  },

  async putExecutionPreparation(id, preparation) {
    await withBlobStorage(async () => {
      await put(executionPreparationPath(id, preparation), JSON.stringify(preparation), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
  },

  async listExecutionObservations(id) {
    return withBlobStorage(async () => {
      const values: StoredSorobanIntentExecutionObservation[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: executionObservationPrefix(id), limit: 100, cursor });
        for (const blob of page.blobs) {
          if (!blob.pathname.endsWith('.json')) continue;
          const value = await readJson<StoredSorobanIntentExecutionObservation>(blob.pathname);
          if (value) values.push(value);
        }
        cursor = page.cursor;
      } while (cursor);
      return values.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.transactionHash.localeCompare(b.transactionHash));
    });
  },

  getExecutionObservation(id, transactionHash) {
    return readJson<StoredSorobanIntentExecutionObservation>(executionObservationPath(id, transactionHash));
  },

  async putExecutionObservation(id, observation) {
    await withBlobStorage(async () => {
      await put(executionObservationPath(id, observation.transactionHash), JSON.stringify(observation), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
  },
};
