import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressBookStore, StoredAddressAlias } from './addressBookStore.js';
import {
  queueSignatureReminderEmail,
  queueSignatureRequestedEmail,
} from './humanNotificationService.js';

const OWNER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const SIGNER = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBK4';

function addressBook(entries: StoredAddressAlias[]): AddressBookStore {
  return {
    async list() { return entries; },
    async get(_owner, subjectType, address) {
      return entries.find((entry) => entry.subjectType === subjectType && entry.address === address) ?? null;
    },
    async put() {},
    async delete() {},
  };
}

test('queues one signature-request email from private signer contact metadata', async () => {
  const calls: unknown[] = [];
  const result = await queueSignatureRequestedEmail({
    requestId: '0123456789ABCDEF',
    assignedByAddress: OWNER,
    signerAddress: SIGNER,
    assignedAt: '2026-10-30T12:00:00Z',
  }, {
    addressBook: addressBook([{
      version: 1,
      address: SIGNER,
      subjectType: 'signer',
      label: 'Bob',
      notificationEmail: 'bob@example.com',
      createdAt: '2026-10-30T11:00:00Z',
      updatedAt: '2026-10-30T11:00:00Z',
    }]),
    enqueue: async (input) => {
      calls.push(input);
      return { eventId: 'event-1', created: true };
    },
  });

  assert.deepEqual(result, { status: 'queued', eventId: 'event-1' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    requestId: '0123456789ABCDEF',
    recipientSignerAddress: SIGNER,
    actorAddress: OWNER,
    destinationEmail: 'bob@example.com',
    createdAt: new Date('2026-10-30T12:00:00Z'),
  });
});

test('does not enqueue when the assigner has no contact email', async () => {
  let enqueueCalls = 0;
  const result = await queueSignatureRequestedEmail({
    requestId: '0123456789ABCDEF',
    assignedByAddress: OWNER,
    signerAddress: SIGNER,
    assignedAt: '2026-10-30T12:00:00Z',
  }, {
    addressBook: addressBook([]),
    enqueue: async () => {
      enqueueCalls += 1;
      return { eventId: 'event-1', created: true };
    },
  });

  assert.deepEqual(result, { status: 'no_contact_email' });
  assert.equal(enqueueCalls, 0);
});

test('preserves outbox idempotency result instead of creating another email', async () => {
  const result = await queueSignatureRequestedEmail({
    requestId: '0123456789ABCDEF',
    assignedByAddress: OWNER,
    signerAddress: SIGNER,
    assignedAt: '2026-10-30T12:00:00Z',
  }, {
    addressBook: addressBook([{
      version: 1,
      address: SIGNER,
      subjectType: 'account',
      label: 'Bob account',
      notificationEmail: 'bob@example.com',
      createdAt: '2026-10-30T11:00:00Z',
      updatedAt: '2026-10-30T11:00:00Z',
    }]),
    enqueue: async () => ({ eventId: 'event-1', created: false }),
  });

  assert.deepEqual(result, { status: 'duplicate', eventId: 'event-1' });
});

test('queues a distinct signature reminder from the original assigner private contact', async () => {
  const calls: unknown[] = [];
  const result = await queueSignatureReminderEmail({
    requestId: '0123456789ABCDEF',
    remindedByAddress: OWNER,
    signerAddress: SIGNER,
  }, {
    addressBook: addressBook([{
      version: 1,
      address: SIGNER,
      subjectType: 'signer',
      label: 'Bob',
      notificationEmail: 'bob@example.com',
      createdAt: '2026-10-30T11:00:00Z',
      updatedAt: '2026-10-30T11:00:00Z',
    }]),
    enqueue: async (input) => {
      calls.push(input);
      return { eventId: 'reminder-1', created: true };
    },
  });

  assert.deepEqual(result, { status: 'queued', eventId: 'reminder-1' });
  assert.deepEqual(calls[0], {
    requestId: '0123456789ABCDEF',
    recipientSignerAddress: SIGNER,
    actorAddress: OWNER,
    destinationEmail: 'bob@example.com',
  });
});

test('prequeues template reminder slots while private Contact email is available', async () => {
  let captured: unknown = null;
  const queued = await queueSignatureRequestedEmail({
    requestId: '0123456789ABCDEF',
    assignedByAddress: OWNER,
    signerAddress: SIGNER,
    assignedAt: '2026-11-20T08:00:00Z',
  }, {
    automationEnabled: true,
    addressBook: addressBook([{
      version: 1, address: SIGNER, subjectType: 'signer',
      label: 'Signer', notificationEmail: 'signer@example.org',
      createdAt: '2026-11-20T07:00:00Z', updatedAt: '2026-11-20T07:00:00Z',
    }]),
    enqueue: async () => ({ eventId: 'initial', created: true }),
    enqueueAuto: async (input) => { captured = input; return 2; },
  });
  assert.equal(queued.status, 'queued');
  assert.deepEqual(captured, {
    requestId: '0123456789ABCDEF',
    signerAddress: SIGNER,
    assignedByAddress: OWNER,
    destinationEmail: 'signer@example.org',
    assignedAt: new Date('2026-11-20T08:00:00Z'),
  });
});

test('manual invite never schedules automatic reminders when the deployment switch is off', async () => {
  let autoCalls = 0;
  await queueSignatureRequestedEmail({
    requestId: '0123456789ABCDEF',
    assignedByAddress: OWNER,
    signerAddress: SIGNER,
    assignedAt: '2026-11-20T08:00:00Z',
  }, {
    automationEnabled: false,
    addressBook: addressBook([{
      version: 1, address: SIGNER, subjectType: 'signer',
      label: 'Signer', notificationEmail: 'signer@example.org',
      createdAt: '2026-11-20T07:00:00Z', updatedAt: '2026-11-20T07:00:00Z',
    }]),
    enqueue: async () => ({ eventId: 'initial', created: true }),
    enqueueAuto: async () => { autoCalls += 1; return 2; },
  });
  assert.equal(autoCalls, 0);
});

test('signature emails prefer MST user contacts over old wallet data, with safe fallback', async () => {
  const userId = '911fa3cf-4c02-4d97-89b8-4ed7d98c2ca5';
  const { userWorkspaceOwner } = await import('./userWorkspaceOwner.js');
  const owner = userWorkspaceOwner('testnet', userId);
  const byOwner = new Map([
    [owner, { version: 1, address: SIGNER, subjectType: 'signer', label: 'New label',
      notificationEmail: 'new@example.org', createdAt: '', updatedAt: '' } as StoredAddressAlias],
    [OWNER, { version: 1, address: SIGNER, subjectType: 'signer', label: 'Old label',
      notificationEmail: 'old@example.org', createdAt: '', updatedAt: '' } as StoredAddressAlias],
  ]);
  const store: AddressBookStore = {
    async list() { return []; },
    async get(o, _kind, address) { return address === SIGNER ? byOwner.get(o) ?? null : null; },
    async put() {},
    async delete() {},
  };
  const identityStore = { async findCredential() { return { userId }; } } as unknown as
    import('./identityStore.js').PostgresIdentityStore;
  let email = '';
  await queueSignatureRequestedEmail({
    requestId: '0123456789ABCDEF', assignedByAddress: OWNER, signerAddress: SIGNER,
    assignedAt: '2026-11-22T00:00:00Z', network: 'testnet',
  }, {
    addressBook: store, identityStore,
    enqueue: async ({ destinationEmail }) => { email = destinationEmail; return { eventId: 'new', created: true }; },
  });
  assert.equal(email, 'new@example.org');
  byOwner.delete(owner);
  await queueSignatureReminderEmail({
    requestId: '0123456789ABCDEF', remindedByAddress: OWNER, signerAddress: SIGNER, network: 'testnet',
  }, {
    addressBook: store, identityStore,
    enqueue: async ({ destinationEmail }) => { email = destinationEmail; return { eventId: 'old', created: true }; },
  });
  assert.equal(email, 'old@example.org');
});
