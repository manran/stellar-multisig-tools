import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { SigningRequestSnapshot } from '../../../../packages/stellar-core/src/requestTypes.js';
import type {
  SigningRequestStore,
  StoredRequestAssignment,
  StoredSigningRequest,
} from './requestStore.js';
import {
  assignSigningRequest,
  requireSigningRequestReminder,
  RequestAssignmentServiceError,
} from './requestAssignmentService.js';

function unsignedPayment(source: string, destination: string): string {
  return new TransactionBuilder(new Account(source, '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination,
      asset: Asset.native(),
      amount: '1',
    }))
    .setTimeout(3600)
    .build()
    .toXDR();
}

function storeFor(request: StoredSigningRequest): SigningRequestStore {
  const assignments = new Map<string, StoredRequestAssignment>();
  return {
    async createRequest() {},
    async getRequest(id) { return id === request.id ? request : null; },
    async listContributions() { return []; },
    async putContribution() {},
    async getSubmission() { return null; },
    async putSubmission() {},
    async listRequestAssignments() { return [...assignments.values()]; },
    async putRequestAssignment(_id, assignment) {
      const current = assignments.get(assignment.signerAddress);
      if (current) return { assignment: current, created: false };
      assignments.set(assignment.signerAddress, assignment);
      return { assignment, created: true };
    },
  };
}

function snapshot(request: StoredSigningRequest): SigningRequestSnapshot {
  return {
    id: request.id,
    network: request.network,
    transactionHash: request.transactionHash,
    baseXdr: request.baseXdr,
    mergedXdr: request.baseXdr,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    contributionCount: 0,
    signatureCount: 0,
    status: 'awaiting_signatures',
    statusReason: 'signatures_required',
  };
}

test('records an explicit Human ask without changing authorization', async () => {
  const source = Keypair.random().publicKey();
  const target = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();
  const request: StoredSigningRequest = {
    version: 1,
    id: '0123456789ABCDEF',
    network: 'testnet',
    baseXdr: unsignedPayment(source, destination),
    transactionHash: 'a'.repeat(64),
    createdAt: '2026-10-30T04:00:00Z',
    expiresAt: '2026-10-31T04:00:00Z',
  };
  const store = storeFor(request);
  const result = await assignSigningRequest(store, request.id, source, target, {
    now: new Date('2026-10-30T04:05:00Z'),
    signerAccess: async (address) => address === source || address === target,
    snapshotLoader: async () => snapshot(request),
  });

  assert.equal(result.created, true);
  assert.equal(result.assignment.signerAddress, target);
  assert.equal(result.assignment.assignedByAddress, source);
  assert.equal(result.assignment.assignedAt, '2026-10-30T04:05:00.000Z');

  const replay = await assignSigningRequest(store, request.id, source, target, {
    now: new Date('2026-10-30T04:06:00Z'),
    signerAccess: async (address) => address === source || address === target,
    snapshotLoader: async () => snapshot(request),
  });
  assert.equal(replay.created, false);
  assert.equal(replay.assignment.assignedAt, result.assignment.assignedAt);
});

test('rejects an ask for an address outside the current signer set', async () => {
  const source = Keypair.random().publicKey();
  const target = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();
  const request: StoredSigningRequest = {
    version: 1,
    id: '0123456789ABCDEF',
    network: 'testnet',
    baseXdr: unsignedPayment(source, destination),
    transactionHash: 'b'.repeat(64),
    createdAt: '2026-10-30T04:00:00Z',
    expiresAt: '2026-10-31T04:00:00Z',
  };
  await assert.rejects(
    () => assignSigningRequest(storeFor(request), request.id, source, target, {
      signerAccess: async (address) => address === source,
      snapshotLoader: async () => snapshot(request),
    }),
    (cause: unknown) => cause instanceof RequestAssignmentServiceError
      && cause.code === 'request_assignment_signer_unavailable',
  );
});

test('rejects assignment after the proposal leaves signature collection', async () => {
  const source = Keypair.random().publicKey();
  const target = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();
  const request: StoredSigningRequest = {
    version: 1,
    id: '0123456789ABCDEF',
    network: 'testnet',
    baseXdr: unsignedPayment(source, destination),
    transactionHash: 'c'.repeat(64),
    createdAt: '2026-10-30T04:00:00Z',
    expiresAt: '2026-10-31T04:00:00Z',
  };
  await assert.rejects(
    () => assignSigningRequest(storeFor(request), request.id, source, target, {
      signerAccess: async () => true,
      snapshotLoader: async () => ({ ...snapshot(request), status: 'ready', statusReason: 'authorization_complete' }),
    }),
    (cause: unknown) => cause instanceof RequestAssignmentServiceError
      && cause.code === 'request_assignment_not_pending',
  );
});

test('only the signer who created the Ask can send its reminder', async () => {
  const source = Keypair.random().publicKey();
  const target = Keypair.random().publicKey();
  const other = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();
  const request: StoredSigningRequest = {
    version: 1,
    id: '0123456789ABCDEF',
    network: 'testnet',
    baseXdr: unsignedPayment(source, destination),
    transactionHash: 'd'.repeat(64),
    createdAt: '2026-10-30T04:00:00Z',
    expiresAt: '2026-10-31T04:00:00Z',
  };
  const store = storeFor(request);
  await assignSigningRequest(store, request.id, source, target, {
    signerAccess: async (address) => address === source || address === target || address === other,
    snapshotLoader: async () => snapshot(request),
  });

  const assignment = await requireSigningRequestReminder(store, request.id, source, target, {
    signerAccess: async (address) => address === source || address === target,
    snapshotLoader: async () => snapshot(request),
  });
  assert.equal(assignment.assignedByAddress, source);
  assert.equal(assignment.signerAddress, target);

  await assert.rejects(
    () => requireSigningRequestReminder(store, request.id, other, target, {
      signerAccess: async () => true,
      snapshotLoader: async () => snapshot(request),
    }),
    (cause: unknown) => cause instanceof RequestAssignmentServiceError
      && cause.code === 'request_reminder_not_owner',
  );
});

test('proposal creator may remind a signer invited by another authorized signer', async () => {
  const originalCreator = Keypair.random().publicKey();
  const inviter = Keypair.random().publicKey();
  const target = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();
  const request: StoredSigningRequest = {
    version: 1,
    id: '0123456789ABCDEF',
    network: 'testnet',
    baseXdr: unsignedPayment(originalCreator, destination),
    transactionHash: 'e'.repeat(64),
    createdAt: '2026-10-30T04:00:00Z',
    expiresAt: '2026-10-31T04:00:00Z',
    creatorAddress: originalCreator,
  };
  const store = storeFor(request);
  const access = async (address: string) =>
    address === originalCreator || address === inviter || address === target;
  await assignSigningRequest(store, request.id, inviter, target, {
    signerAccess: access,
    snapshotLoader: async () => snapshot(request),
  });
  const reminder = await requireSigningRequestReminder(store, request.id, originalCreator, target, {
    signerAccess: access,
    snapshotLoader: async () => snapshot(request),
  });
  assert.equal(reminder.assignedByAddress, inviter, 'Original Ask provenance is unchanged');
  assert.equal(reminder.signerAddress, target);
});


test('delegated proposer can ask and remind only eligible signers on their own Request', async () => {
  const proposer = Keypair.random().publicKey();
  const source = Keypair.random().publicKey();
  const signer = Keypair.random().publicKey();
  const outsider = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();
  const request: StoredSigningRequest = {
    version: 1, id: '1234567890ABCDEF', network: 'testnet',
    baseXdr: unsignedPayment(source, destination), transactionHash: 'a'.repeat(64),
    createdAt: '2026-11-21T09:00:00.000Z', expiresAt: '2026-11-21T13:00:00.000Z',
    proposerAddress: proposer,
  };
  const store = storeFor(request);
  const validSigner = async (address: string) => address === source || address === signer;
  const options = {
    allowProposer: true,
    signerAccess: validSigner,
    snapshotLoader: async () => snapshot(request),
  };
  const ask = await assignSigningRequest(store, request.id, proposer, signer, options);
  assert.equal(ask.created, true);
  assert.equal(ask.assignment.assignedByAddress, proposer);
  const reminded = await requireSigningRequestReminder(store, request.id, proposer, signer, options);
  assert.equal(reminded.signerAddress, signer);

  await assert.rejects(
    () => assignSigningRequest(store, request.id, outsider, source, options),
    (e: unknown) => e instanceof RequestAssignmentServiceError && e.code === 'request_assignment_not_authorized',
  );
  await assert.rejects(
    () => assignSigningRequest(store, request.id, proposer, outsider, options),
    (e: unknown) => e instanceof RequestAssignmentServiceError && e.code === 'request_assignment_signer_unavailable',
  );
  await assert.rejects(
    () => assignSigningRequest(store, request.id, proposer, proposer, options),
    (e: unknown) => e instanceof RequestAssignmentServiceError && e.code === 'request_assignment_self',
  );
  await assert.rejects(
    () => assignSigningRequest(store, request.id, proposer, source, { ...options, allowProposer: false }),
    (e: unknown) => e instanceof RequestAssignmentServiceError && e.code === 'request_assignment_not_authorized',
  );
  await assert.rejects(
    () => requireSigningRequestReminder(store, request.id, outsider, signer, options),
    (e: unknown) => e instanceof RequestAssignmentServiceError && e.code === 'request_reminder_not_owner',
  );
});
