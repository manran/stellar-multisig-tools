import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import type { AuthStore, StoredAuthServerKey, StoredRedeemedChallenge } from './authStore.js';
import {
  CONTRIBUTION_GRANT_TTL_SECONDS,
  contributionGrantCookie,
  contributionGrantFromRequest,
  issueContributionGrant,
} from './contributionGrant.js';

class MemoryAuthStore implements AuthStore {
  key: StoredAuthServerKey | null = null;
  async getServerKey() { return this.key; }
  async createServerKey(key: StoredAuthServerKey) { this.key ??= key; }
  async claimChallengeRedemption(_redemption: StoredRedeemedChallenge) { return true; }
}

const config = {
  homeDomain: 'stellar.multisig.tools',
  issuer: 'https://stellar.multisig.tools/api/auth',
};

test('contribution grant is signed, request-scoped, and expires after fifteen minutes', async () => {
  const store = new MemoryAuthStore();
  const signer = Keypair.random();
  const now = new Date('2026-09-03T08:00:00.000Z');
  const issued = await issueContributionGrant(store, {
    address: signer.publicKey(),
    network: 'testnet',
    requestId: 'A'.repeat(16),
    contributionDigest: 'f'.repeat(64),
  }, { ...config, now });

  assert.equal(issued.grant.expiresAt - issued.grant.issuedAt, CONTRIBUTION_GRANT_TTL_SECONDS);
  const cookie = contributionGrantCookie(issued.token);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\/api\/request/);

  const request = new Request('https://stellar.multisig.tools/api/request', {
    headers: { cookie: cookie.split(';')[0] },
  });
  const verified = await contributionGrantFromRequest(store, request, {
    ...config,
    now: new Date(now.getTime() + 60_000),
  });
  assert.equal(verified?.address, signer.publicKey());
  assert.equal(verified?.requestId, 'A'.repeat(16));

  const expired = await contributionGrantFromRequest(store, request, {
    ...config,
    now: new Date(now.getTime() + (CONTRIBUTION_GRANT_TTL_SECONDS + 1) * 1000),
  });
  assert.equal(expired, null);
});
