import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePrivateNote, privateNoteByteLength } from '../../../../packages/stellar-core/src/privateNote.js';
import { latestPrivateNote, revisePrivateNote } from './requestPrivateNote.js';
import type { SigningRequestStore } from './requestStore.js';
import type { PrivateNoteRevision } from '../../../../packages/stellar-core/src/privateNote.js';

function noteStore() {
  const notes: PrivateNoteRevision[] = [];
  const store = {
    getRequest: async () => null,
    listPrivateNoteRevisions: async () => notes,
    putPrivateNoteRevision: async (_id: string, revision: PrivateNoteRevision) => { notes.push(revision); },
  } as unknown as SigningRequestStore;
  return { store, notes };
}

test('normalizes private note text and counts UTF-8 bytes', () => {
  assert.equal(normalizePrivateNote('  Payroll batch  '), 'Payroll batch');
  assert.equal(privateNoteByteLength('萤火'), 6);
  assert.throws(() => normalizePrivateNote('   '), /cannot be empty/i);
});

test('initial private note stored with the Request is readable before later revisions exist', async () => {
  const initial: PrivateNoteRevision = {
    version: 1,
    revisionId: 'initial',
    text: 'Off-chain payment context',
    createdAt: '2026-08-30T09:00:00.000Z',
  };
  const store = {
    getRequest: async () => ({ initialPrivateNote: initial }),
    listPrivateNoteRevisions: async () => [],
  } as unknown as SigningRequestStore;

  assert.equal((await latestPrivateNote(store, 'REQUEST'))?.text, 'Off-chain payment context');
});

test('private note revisions are append-only and latest wins by time', async () => {
  const { store, notes } = noteStore();
  const first = await revisePrivateNote(store, 'REQUEST', 'First note', {
    now: new Date('2026-08-30T10:00:00.000Z'),
    revisionIdFactory: () => 'rev-1',
  });
  const second = await revisePrivateNote(store, 'REQUEST', 'Second note', {
    now: new Date('2026-08-30T11:00:00.000Z'),
    actorAddress: 'GACTOR',
    revisionIdFactory: () => 'rev-2',
  });

  assert.equal(notes.length, 2);
  assert.equal(first.text, 'First note');
  assert.equal(second.actorAddress, 'GACTOR');
  assert.equal((await latestPrivateNote(store, 'REQUEST'))?.revisionId, 'rev-2');
});
