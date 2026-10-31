import type { AddressBookStore } from './addressBookStore.js';
import { blobAddressBookStore } from './blobAddressBookStore.js';
import {
  enqueueSignatureReminderNotification,
  enqueueSignatureRequestedNotification,
} from '../db/postgresHumanNotificationOutbox.js';

export type HumanNotificationQueueResult =
  | { status: 'queued'; eventId: string }
  | { status: 'duplicate'; eventId: string }
  | { status: 'no_contact_email' };

async function notificationEmail(
  addressBook: AddressBookStore,
  ownerAddress: string,
  signerAddress: string,
): Promise<string | undefined> {
  const signerEntry = await addressBook.get(ownerAddress, 'signer', signerAddress);
  const accountEntry = signerEntry?.notificationEmail
    ? null
    : await addressBook.get(ownerAddress, 'account', signerAddress);
  return signerEntry?.notificationEmail ?? accountEntry?.notificationEmail;
}

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
): Promise<HumanNotificationQueueResult> {
  const addressBook = dependencies.addressBook ?? blobAddressBookStore;
  const enqueue = dependencies.enqueue ?? enqueueSignatureRequestedNotification;
  const destinationEmail = await notificationEmail(addressBook, input.assignedByAddress, input.signerAddress);
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

export async function queueSignatureReminderEmail(
  input: {
    requestId: string;
    remindedByAddress: string;
    signerAddress: string;
  },
  dependencies: {
    addressBook?: AddressBookStore;
    enqueue?: typeof enqueueSignatureReminderNotification;
  } = {},
): Promise<Exclude<HumanNotificationQueueResult, { status: 'duplicate' }>> {
  const addressBook = dependencies.addressBook ?? blobAddressBookStore;
  const enqueue = dependencies.enqueue ?? enqueueSignatureReminderNotification;
  const destinationEmail = await notificationEmail(addressBook, input.remindedByAddress, input.signerAddress);
  if (!destinationEmail) return { status: 'no_contact_email' };

  const queued = await enqueue({
    requestId: input.requestId,
    recipientSignerAddress: input.signerAddress,
    actorAddress: input.remindedByAddress,
    destinationEmail,
  });
  return { status: 'queued', eventId: queued.eventId };
}
