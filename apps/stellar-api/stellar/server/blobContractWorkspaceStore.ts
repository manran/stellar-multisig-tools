import { createHash } from 'node:crypto';
import { del, get, list, put } from './privateObjectStorage.js';
import type { ContractWorkspacePrincipal } from './contractWorkspaceStore.js';
import type { ContractWorkspaceStore, StoredContractWorkspace } from './contractWorkspaceStore.js';
import { withBlobStorage } from './blobRequestStore.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function principalPrefix(principal: ContractWorkspacePrincipal): string {
  if (principal.type === 'user') {
    return `contract-workspaces/${principal.network}/users/${digest(principal.userId)}/`;
  }
  return `contract-workspaces/${principal.network}/${digest(principal.address)}/`;
}

function importMarker(principal: ContractWorkspacePrincipal, wallet: string): string {
  return `${principalPrefix(principal)}imported/${digest(wallet)}.done`;
}

function workspacePath(principal: ContractWorkspacePrincipal, contractId: string): string {
  return `${principalPrefix(principal)}${digest(contractId)}.json`;
}

async function readJson<T>(pathname: string): Promise<T | null> {
  return withBlobStorage(async () => {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as T;
  });
}

export const blobContractWorkspaceStore: ContractWorkspaceStore = {
  async hasImportedWallet(principal, wallet) {
    return withBlobStorage(async () => Boolean(await get(importMarker(principal, wallet), { access: 'private', useCache: false })));
  },
  async markImportedWallet(principal, wallet) {
    await withBlobStorage(async () => {
      await put(importMarker(principal, wallet), 'imported', {
        access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'text/plain',
      });
    });
  },
  async list(principal) {
    return withBlobStorage(async () => {
      const entries: StoredContractWorkspace[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: principalPrefix(principal), limit: 100, cursor });
        for (const blob of page.blobs) {
          if (!blob.pathname.endsWith('.json')) continue;
          const entry = await readJson<StoredContractWorkspace>(blob.pathname);
          if (entry?.version === 1) entries.push(entry);
        }
        cursor = page.cursor;
      } while (cursor);
      return entries;
    });
  },

  get(principal, contractId) {
    return readJson<StoredContractWorkspace>(workspacePath(principal, contractId));
  },

  async put(principal, workspace) {
    await withBlobStorage(async () => {
      await put(workspacePath(principal, workspace.contractId), JSON.stringify(workspace), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
  },

  async delete(principal, contractId) {
    await withBlobStorage(async () => {
      await del(workspacePath(principal, contractId));
    });
  },
};
