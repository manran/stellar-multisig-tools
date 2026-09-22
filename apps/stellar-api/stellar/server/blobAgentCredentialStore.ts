import { del, get, list, put } from '@vercel/blob';
import type { SignerPrincipalRef } from '../../../../packages/stellar-core/src/agentAccessTypes.js';
import { withBlobStorage } from './blobRequestStore.js';
import type {
  AgentCredentialStore,
  StoredAgentIdempotencyClaim,
  StoredSignerAgentCredential,
} from './agentCredentialStore.js';

function safePart(value: string): string {
  return encodeURIComponent(value);
}

function credentialPath(credentialId: string): string {
  return `signer-agent-credentials/${safePart(credentialId)}.json`;
}

function usagePath(credentialId: string): string {
  return `signer-agent-credential-usage/${safePart(credentialId)}.json`;
}

function idempotencyPath(credentialId: string, hash: string): string {
  return `agent-idempotency/${safePart(credentialId)}/${hash}.json`;
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

function samePrincipal(a: SignerPrincipalRef, b: SignerPrincipalRef): boolean {
  return a.type === b.type && a.network === b.network && a.address === b.address;
}

export const blobAgentCredentialStore: AgentCredentialStore = {
  async listCredentials(principal) {
    const credentials = (await listJson<StoredSignerAgentCredential>('signer-agent-credentials/'))
      .filter((item) => samePrincipal(item.principal, principal));
    const enriched = await Promise.all(credentials.map(async (item) => {
      const usage = await readJson<{ lastUsedAt: string }>(usagePath(item.credentialId));
      return usage?.lastUsedAt ? { ...item, lastUsedAt: usage.lastUsedAt } : item;
    }));
    return enriched.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  getCredential(credentialId) {
    return readJson<StoredSignerAgentCredential>(credentialPath(credentialId));
  },

  putCredential(credential) {
    return putJson(credentialPath(credential.credentialId), credential, true);
  },

  touchCredential(credentialId, usedAt) {
    return putJson(usagePath(credentialId), { lastUsedAt: usedAt }, true);
  },

  async claimIdempotency(claim) {
    const pathname = idempotencyPath(claim.credentialId, claim.idempotencyHash);
    const existing = await readJson<StoredAgentIdempotencyClaim>(pathname);
    if (existing) return { claimed: false, claim: existing };
    try {
      await putJson(pathname, claim, false);
      return { claimed: true, claim };
    } catch (cause) {
      const raced = await readJson<StoredAgentIdempotencyClaim>(pathname);
      if (raced) return { claimed: false, claim: raced };
      throw cause;
    }
  },

  async releaseIdempotency(claim) {
    const pathname = idempotencyPath(claim.credentialId, claim.idempotencyHash);
    const current = await readJson<StoredAgentIdempotencyClaim>(pathname);
    if (!current || current.requestId !== claim.requestId) return;
    await withBlobStorage(() => del(pathname));
  },
};
