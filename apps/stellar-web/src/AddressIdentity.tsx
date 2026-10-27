import AddressAliasEditor from './AddressAliasEditor';
import { useAddressBook } from './AddressBookContext';
import type { AddressAliasSubjectType } from './AddressBookContext';

interface Props {
  address: string;
  subjectType: AddressAliasSubjectType;
  allowNaming?: boolean;
  labelOverride?: string;
  className?: string;
}

function shortAddress(address: string) {
  return address.length <= 22 ? address : `${address.slice(0, 10)}…${address.slice(-8)}`;
}

export default function AddressIdentity({ address, subjectType, allowNaming = false, labelOverride = '', className = '' }: Props) {
  const { labelFor } = useAddressBook();
  const label = labelOverride.trim() || labelFor(address, subjectType);

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="transaction-evidence-human-label flex flex-wrap items-center gap-2">
        {label && <span className="text-sm font-semibold">{label}</span>}
        {allowNaming && <AddressAliasEditor address={address} subjectType={subjectType} compact={Boolean(label)} />}
      </div>
      <div className={`transaction-evidence-address-line ${label ? 'mt-0.5 text-xs text-neutral-500 dark:text-neutral-400' : 'text-sm text-neutral-700 dark:text-neutral-200'} font-mono`} title={address}>
        <span className="transaction-evidence-address-short sm:hidden">{shortAddress(address)}</span>
        <span className="transaction-evidence-address-full hidden break-all sm:inline">{address}</span>
      </div>
    </div>
  );
}
