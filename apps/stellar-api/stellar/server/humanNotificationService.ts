import type { AddressBookStore } from './addressBookStore.js';
import { blobAddressBookStore } from './blobAddressBookStore.js';
import { enqueueSignatureRequestedNotification } from '../db/postgresHumanNotificationOutbox.js';

export type SignatureRequestedQueueResult =
  | { status: 'queued'; eventId: string }
  | { status: 'duplicate'; eventId: string }
  | { status: 'no_contact_email' };

export async function queueSignatureRequestedEmail(
  input: {
    requestId: string;
    assignedByAddress: string;
    signerAddress: string;
    assignedAt: string;
  },
  dependencies: {
    addressBook?: AddressBookStore;
    enqueue?: typeof enqueueSignatureRequestedNotification;
  } = {},
): Promise<SignatureRequestedQueueResult> {
  const addressBook = dependencies.addressBook ?? blobAddressBookStore;
  const enqueue = dependencies.enqueue ?? enqueueSignatureRequestedNotification;

  const signerEntry = await addressBook.get(input.assignedByAddress, 'signer', input.signerAddress);
  const accountEntry = signerEntry?.notificationEmail
    ? null
    : await addressBook.get(input.assignedByAddress, 'account', input.signerAddress);
  const destinationEmail = signerEntry?.notificationEmail ?? accountEntry?.notificationEmail;
  if (!destinationEmail) return { status: 'no_contact_email' };

  const queued = await enqueue({
    requestId: input.requestId,
    recipientSignerAddress: input.signerAddress,
    actorAddress: input.assignedByAddress,
    destinationEmail,
    createdAt: new Date(input.assignedAt),
  });
  return queued.created
    ? { status: 'queued', eventId: queued.eventId }
    : { status: 'duplicate', eventId: queued.eventId };
}
