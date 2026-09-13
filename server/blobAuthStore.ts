import { get, put } from '@vercel/blob';
import type { AuthStore, StoredAuthServerKey, StoredRedeemedChallenge } from './authStore.js';
import { withBlobStorage } from './blobRequestStore.js';

async function readJson<T>(pathname: string): Promise<T | null> {
  return withBlobStorage(async () => {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as T;
  });
}

const SERVER_KEY_PATH = 'auth/server-key.json';

export const blobAuthStore: AuthStore = {
  getServerKey() {
    return readJson<StoredAuthServerKey>(SERVER_KEY_PATH);
  },

  async createServerKey(key) {
    await withBlobStorage(async () => {
      try {
        await put(SERVER_KEY_PATH, JSON.stringify(key), {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
        });
      } catch (cause) {
        // Two cold starts can race to bootstrap the service identity. If another
        // instance won, the stable key now exists and this call is successful.
        if (await readJson<StoredAuthServerKey>(SERVER_KEY_PATH)) return;
        throw cause;
      }
    });
  },

  async claimChallengeRedemption(redemption) {
    return withBlobStorage(async () => {
      const path = `auth/redeemed/${redemption.transactionHash}.json`;
      try {
        await put(path, JSON.stringify(redemption), {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
        });
        return true;
      } catch (cause) {
        if (await readJson<StoredRedeemedChallenge>(path)) return false;
        throw cause;
      }
    });
  },
};
