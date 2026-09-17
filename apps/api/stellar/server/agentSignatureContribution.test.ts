import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TimeoutInfinite,
  TransactionBuilder,
} from '@stellar/stellar-sdk/base';
import { contributeSigningRequest, createSigningRequest, SigningRequestServiceError } from './requestService.js';
import type {
  SigningRequestStore,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from './requestStore.js';
import type { StellarAccountSnapshot } from '../../../../src/stellar/types.js';

class MemoryRequestStore implements SigningRequestStore {
  requests = new Map<string, StoredSigningRequest>();
  contributions = new Map<string, StoredSignatureContribution[]>();
  submissions = new Map<string, StoredSubmissionResult>();
  async createRequest(request: StoredSigningRequest) { this.requests.set(request.id, request); }
  async getRequest(id: string) { return this.requests.get(id) ?? null; }
  async listContributions(id: string) { return this.contributions.get(id) ?? []; }
  async putContribution(id: string, contribution: StoredSignatureContribution) { this.contributions.set(id, [...(this.contributions.get(id) ?? []), contribution]); }
  async getSubmission(id: string, hash: string) { const item = this.submissions.get(id); return item?.transactionHash === hash ? item : null; }
  async putSubmission(id: string, item: StoredSubmissionResult) { this.submissions.set(id, item); }
}

test('Agent Sign contribution accepts only newly added signatures from its Signer Principal', async () => {
  const alice = Keypair.random();
  const bob = Keypair.random();
  const tx = new TransactionBuilder(new Account(alice.publicKey(), '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(TimeoutInfinite)
    .build();
  const account: StellarAccountSnapshot = {
    accountId: alice.publicKey(), sequence: '1', subentryCount: 1, numSponsoring: 0, numSponsored: 0,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [
      { key: alice.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: bob.publicKey(), type: 'ed25519_public_key', weight: 1 },
    ],
  };
  const store = new MemoryRequestStore();
  const created = await createSigningRequest(store, { network: 'testnet', xdr: tx.toXdr() }, {
    accountLoader: async () => account,
    idFactory: () => 'A'.repeat(16),
  });

  const bobSigned = TransactionBuilder.fromXdr(tx.toXdr(), Networks.TESTNET);
  bobSigned.sign(bob);
  await assert.rejects(
    () => contributeSigningRequest(store, created.id, bobSigned.toXdr(), {
      accountLoader: async () => account,
      expectedSignerAddress: alice.publicKey(),
      contributionActor: { type: 'agent', id: 'agent-alice', label: 'Alice Agent', principalAddress: alice.publicKey() },
    }),
    (cause: unknown) => cause instanceof SigningRequestServiceError && cause.code === 'agent_signature_principal_mismatch',
  );
  assert.equal((await store.listContributions(created.id)).length, 0);

  const aliceSigned = TransactionBuilder.fromXdr(tx.toXdr(), Networks.TESTNET);
  aliceSigned.sign(alice);
  const accepted = await contributeSigningRequest(store, created.id, aliceSigned.toXdr(), {
    accountLoader: async () => account,
    expectedSignerAddress: alice.publicKey(),
    contributionActor: { type: 'agent', id: 'agent-alice', label: 'Alice Agent', principalAddress: alice.publicKey() },
  });
  assert.deepEqual(accepted.acceptedSignerAddresses, [alice.publicKey()]);
  const contribution = (await store.listContributions(created.id))[0];
  assert.equal(contribution.submittedBy?.id, 'agent-alice');
  assert.equal(contribution.acceptedSignatures?.[0]?.signerKey, alice.publicKey());
});
