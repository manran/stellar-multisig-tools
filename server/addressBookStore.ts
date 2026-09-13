export type AddressAliasSubjectType = 'account' | 'signer';

export interface StoredAddressAlias {
  version: 1;
  address: string;
  subjectType: AddressAliasSubjectType;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface AddressBookStore {
  list(ownerAddress: string): Promise<StoredAddressAlias[]>;
  get(ownerAddress: string, subjectType: AddressAliasSubjectType, address: string): Promise<StoredAddressAlias | null>;
  put(ownerAddress: string, entry: StoredAddressAlias): Promise<void>;
  delete(ownerAddress: string, subjectType: AddressAliasSubjectType, address: string): Promise<void>;
}
