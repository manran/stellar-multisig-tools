import { get, list, put } from './privateObjectStorage.js';
import type { BoxAuditEvent, TreasuryBoxMetadata, TreasuryBoxRef } from '../../../../packages/stellar-core/src/boxTypes.js';
import { withBlobStorage } from './blobRequestStore.js';
import type { BoxStore, StoredTreasuryAuditKey } from './boxStore.js';

function safePart(value: string): string {
  return encodeURIComponent(value);
}

function boxPrefix(box: TreasuryBoxRef): string {
  return `boxes/treasury/${box.network}/${safePart(box.accountId)}`;
}

function metadataPath(box: TreasuryBoxRef): string {
  return `${boxPrefix(box)}/metadata.json`;
}

function auditPath(event: BoxAuditEvent): string {
  return `${boxPrefix(event.box)}/audit/${event.occurredAt.replaceAll(':', '-')}-${safePart(event.eventId)}.json`;
}

function auditKeyPath(keyId: string): string {
  return `treasury-audit-keys/${safePart(keyId)}.json`;
}

function auditKeyUsagePath(keyId: string): string {
  return `treasury-audit-key-usage/${safePart(keyId)}.json`;
}

async function readJson<T>(pathname: string): Promise<T | null> {
  return withBlobStorage(async () => {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as T;
  });
}

async function putJson(pathname: string, value: unknown, allowOverwrite: boolean): Promise<void> {
  await withBlobStorage(async () => {
    await put(pathname, JSON.stringify(value), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
    });
  });
}

async function listJson<T>(prefix: string): Promise<T[]> {
  return withBlobStorage(async () => {
    const values: T[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, limit: 100, cursor });
      for (const blob of page.blobs) {
        if (!blob.pathname.endsWith('.json')) continue;
        const value = await readJson<T>(blob.pathname);
        if (value) values.push(value);
      }
      cursor = page.cursor;
    } while (cursor);
    return values;
  });
}

function sameBox(a: TreasuryBoxRef, b: TreasuryBoxRef): boolean {
  return a.type === b.type && a.network === b.network && a.accountId === b.accountId;
}

export const blobBoxStore: BoxStore = {
  getMetadata(box) {
    return readJson<TreasuryBoxMetadata>(metadataPath(box));
  },

  putMetadata(metadata) {
    return putJson(metadataPath(metadata.box), metadata, true);
  },

  async listAuditKeys(box) {
    const keys = (await listJson<StoredTreasuryAuditKey>('treasury-audit-keys/'))
      .filter((key) => sameBox(key.box, box));
    const enriched = await Promise.all(keys.map(async (key) => {
      const usage = await readJson<{ lastUsedAt: string }>(auditKeyUsagePath(key.keyId));
      return usage?.lastUsedAt ? { ...key, lastUsedAt: usage.lastUsedAt } : key;
    }));
    return enriched.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  getAuditKey(keyId) {
    return readJson<StoredTreasuryAuditKey>(auditKeyPath(keyId));
  },

  putAuditKey(key) {
    return putJson(auditKeyPath(key.keyId), key, true);
  },

  touchAuditKey(keyId, usedAt) {
    return putJson(auditKeyUsagePath(keyId), { lastUsedAt: usedAt }, true);
  },

  async listAuditEvents(box) {
    const events = await listJson<BoxAuditEvent>(`${boxPrefix(box)}/audit/`);
    return events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId));
  },

  async putAuditEvent(event) {
    const pathname = auditPath(event);
    if (await readJson<BoxAuditEvent>(pathname)) return;
    try {
      await putJson(pathname, event, false);
    } catch (cause) {
      if (await readJson<BoxAuditEvent>(pathname)) return;
      throw cause;
    }
  },
};
