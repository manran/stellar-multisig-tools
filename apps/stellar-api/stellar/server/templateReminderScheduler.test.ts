import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import type { SigningRequestStore } from './requestStore.js';
import {
  isTemplateAutoReminderEventId,
  templateAutoReminderEventId,
} from '../db/postgresHumanNotificationOutbox.js';
import { RequestAssignmentServiceError } from './requestAssignmentService.js';
import {
  templateReminderAutomationEnabled,
  templateReminderStillNeeded,
} from './templateReminderScheduler.js';

const requestId = '0123456789ABCDEF';
const signer = Keypair.random().publicKey();
const sender = Keypair.random().publicKey();
const expiresAt = '2026-11-23T12:00:00.000Z';

test('automatic reminders require explicit deployment enablement', () => {
  assert.equal(templateReminderAutomationEnabled(''), false);
  assert.equal(templateReminderAutomationEnabled('0'), false);
  assert.equal(templateReminderAutomationEnabled('1'), true);
});

test('each stage has a stable id and manual reminders use another namespace', () => {
  const first = templateAutoReminderEventId(requestId, signer, 1);
  const second = templateAutoReminderEventId(requestId, signer, 2);
  assert.equal(first, templateAutoReminderEventId(requestId, signer, 1));
  assert.notEqual(first, second);
  assert.equal(isTemplateAutoReminderEventId(first), true);
  assert.equal(isTemplateAutoReminderEventId(second), true);
  assert.equal(isTemplateAutoReminderEventId(first + ':random'), false);
});

test('live validation skips expired and completed signer assignments', async () => {
  const expiry = await templateReminderStillNeeded(requestId, sender, signer, '2026-11-20T12:00:00Z', {
    now: () => new Date('2026-11-20T12:00:00Z'),
    verify: async () => { throw Error('should not verify expired'); },
  });
  assert.equal(expiry, false);
  const complete = await templateReminderStillNeeded(requestId, sender, signer, expiresAt, {
    now: () => new Date('2026-11-21T12:00:00Z'),
    store: {} as SigningRequestStore,
    verify: async () => {
      throw new RequestAssignmentServiceError('Already signed', 409, 'request_reminder_already_signed');
    },
  });
  assert.equal(complete, false);
  await assert.rejects(
    () => templateReminderStillNeeded(requestId, sender, signer, expiresAt, {
      now: () => new Date('2026-11-21T12:00:00Z'),
      store: {} as SigningRequestStore,
      verify: async () => { throw Error('RPC outage'); },
    }),
    /RPC outage/,
  );
});
