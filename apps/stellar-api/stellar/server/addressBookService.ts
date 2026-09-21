import { Keypair } from '@stellar/stellar-sdk/base';
import type { AddressAliasSubjectType, AddressBookStore, StoredAddressAlias } from './addressBookStore.js';

const MAX_LABEL_LENGTH = 64;

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
  input: { address: string; subjectType: string; label: string },
  now = new Date(),
): Promise<StoredAddressAlias> {
  const ownerAddress = normalizeAddress(ownerAddressValue);
  const address = normalizeAddress(input.address);
  const subjectType = normalizeSubjectType(input.subjectType);
  const label = normalizeLabel(input.label);
  const existing = await store.get(ownerAddress, subjectType, address);
  const timestamp = now.toISOString();
  const entry: StoredAddressAlias = {
    version: 1,
    address,
    subjectType,
    label,
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
