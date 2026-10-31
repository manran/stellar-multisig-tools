import { Keypair } from '@stellar/stellar-sdk/base';
import type { AddressAliasSubjectType, AddressBookStore, StoredAddressAlias } from './addressBookStore.js';

const MAX_LABEL_LENGTH = 64;
const MAX_NOTIFICATION_EMAIL_LENGTH = 254;

export class AddressBookServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'AddressBookServiceError';
    this.status = status;
    this.code = code;
  }
}

function normalizeAddress(value: string): string {
  const address = value.trim();
  try {
    Keypair.fromPublicKey(address);
  } catch {
    throw new AddressBookServiceError('A valid Stellar G address is required.', 400, 'invalid_address');
  }
  return address;
}

function normalizeSubjectType(value: string): AddressAliasSubjectType {
  if (value === 'account' || value === 'signer') return value;
  throw new AddressBookServiceError('Alias subject type must be account or signer.', 400, 'invalid_subject_type');
}

function normalizeLabel(value: string): string {
  const label = value.trim().replace(/\s+/g, ' ');
  if (!label) throw new AddressBookServiceError('A name is required.', 400, 'invalid_label');
  if (label.length > MAX_LABEL_LENGTH) {
    throw new AddressBookServiceError(`Names must be ${MAX_LABEL_LENGTH} characters or fewer.`, 400, 'invalid_label');
  }
  if (/[\u0000-\u001f\u007f]/.test(label)) {
    throw new AddressBookServiceError('Name contains unsupported control characters.', 400, 'invalid_label');
  }
  return label;
}

function normalizeNotificationEmail(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new AddressBookServiceError('Notification email must be a valid email address.', 400, 'invalid_notification_email');
  }
  const email = value.trim();
  if (!email) return null;
  const at = email.indexOf('@');
  const dot = email.lastIndexOf('.');
  if (
    email.length > MAX_NOTIFICATION_EMAIL_LENGTH
    || /[\u0000-\u0020\u007f]/.test(email)
    || at <= 0
    || at !== email.lastIndexOf('@')
    || dot <= at + 1
    || dot === email.length - 1
  ) {
    throw new AddressBookServiceError('Notification email must be a valid email address.', 400, 'invalid_notification_email');
  }
  return email;
}

export async function listAddressAliases(
  store: AddressBookStore,
  ownerAddressValue: string,
): Promise<StoredAddressAlias[]> {
  const ownerAddress = normalizeAddress(ownerAddressValue);
  const entries = await store.list(ownerAddress);
  return [...entries].sort((left, right) =>
    left.label.localeCompare(right.label)
    || left.subjectType.localeCompare(right.subjectType)
    || left.address.localeCompare(right.address),
  );
}

export async function upsertAddressAlias(
  store: AddressBookStore,
  ownerAddressValue: string,
  input: { address: string; subjectType: string; label: string; notificationEmail?: unknown },
  now = new Date(),
): Promise<StoredAddressAlias> {
  const ownerAddress = normalizeAddress(ownerAddressValue);
  const address = normalizeAddress(input.address);
  const subjectType = normalizeSubjectType(input.subjectType);
  const label = normalizeLabel(input.label);
  const notificationEmailUpdate = normalizeNotificationEmail(input.notificationEmail);
  const existing = await store.get(ownerAddress, subjectType, address);
  const notificationEmail = notificationEmailUpdate === undefined
    ? existing?.notificationEmail
    : notificationEmailUpdate ?? undefined;
  const timestamp = now.toISOString();
  const entry: StoredAddressAlias = {
    version: 1,
    address,
    subjectType,
    label,
    ...(notificationEmail ? { notificationEmail } : {}),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await store.put(ownerAddress, entry);
  return entry;
}

export async function deleteAddressAlias(
  store: AddressBookStore,
  ownerAddressValue: string,
  input: { address: string; subjectType: string },
): Promise<void> {
  const ownerAddress = normalizeAddress(ownerAddressValue);
  const address = normalizeAddress(input.address);
  const subjectType = normalizeSubjectType(input.subjectType);
  await store.delete(ownerAddress, subjectType, address);
}
