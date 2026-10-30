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
