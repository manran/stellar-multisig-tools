import { createPostgresSigningRequestStore } from '../db/postgresSigningRequestStore.js';
import { coordinationPool } from '../db/postgres.js';
import type { RequestPrivateDataStore } from './requestPrivateDataStore.js';
import type { SigningRequestStore } from './requestStore.js';
import {
  RequestAssignmentServiceError,
  requireSigningRequestReminder,
} from './requestAssignmentService.js';

// The email worker has no private-blob credentials. The reminder guard reads
// only the transaction and chain signer rules; it must not fetch or write
// private notes, and it never emits coordination outbox changes.
const publicOnlyRequestData: RequestPrivateDataStore = {
  async getRequestPrivateData() { return null; },
  async listPrivateNoteRevisions() { return []; },
  async putRequestPrivateData() { throw new Error('Read-only worker'); },
  async putPrivateNoteRevision() { throw new Error('Read-only worker'); },
};

const STOP_CODES = new Set([
  'request_not_found',
  'request_reminder_assignment_required',
  'request_reminder_not_owner',
  'request_reminder_signer_unavailable',
  'request_reminder_not_pending',
  'request_reminder_already_signed',
]);

export function templateReminderAutomationEnabled(
  value = process.env.MULTISIG_TEMPLATE_AUTO_REMINDERS_ENABLED,
): boolean {
  return value === '1';
}

// A final, live check happens again immediately before dispatch, not only
// when a reminder is queued. Successful authorization cancels the reminder.
export async function templateReminderStillNeeded(
  requestId: string,
  actorAddress: string,
  signerAddress: string,
  expiresAt: string,
  dependencies: {
    now?: () => Date;
    verify?: typeof requireSigningRequestReminder;
    store?: SigningRequestStore;
  } = {},
): Promise<boolean> {
  const now = dependencies.now ?? (() => new Date());
  if (Date.parse(expiresAt) - now().getTime() <= 15 * 60_000) return false;
  const verify = dependencies.verify ?? requireSigningRequestReminder;
  try {
    await verify(
      dependencies.store ?? createPostgresSigningRequestStore(coordinationPool(), publicOnlyRequestData, { emitOutbox: false }),
      requestId,
      actorAddress,
      signerAddress,
    );
    return true;
  } catch (cause) {
    if (cause instanceof RequestAssignmentServiceError && STOP_CODES.has(cause.code)) return false;
    throw cause;
  }
}

