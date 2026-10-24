import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import AddressAliasEditor from './AddressAliasEditor';
import { useAddressBook } from './AddressBookContext';
import { useStellarWallet } from './StellarWalletContext';
import { isValidStellarAccountId } from '../../../packages/stellar-core/src/horizon';
import { addSavedSignerRow, removeSignerInputRow, updateSignerInputRows } from './stellar/signerInputs';

interface Props {
  values: string[];
  errors: string[];
  masterAccountId: string;
  onChange: (values: string[]) => void;
}

function shortAddress(address: string) {
  return address.length <= 18 ? address : `${address.slice(0, 7)}…${address.slice(-6)}`;
}

export default function SignerIdentityList({ values, errors, masterAccountId, onChange }: Props) {
  const { privateUnlocked, authBusy, unlock } = useStellarWallet();
  const { entries, labelFor } = useAddressBook();
  const selected = useMemo(() => new Set(values.map((value) => value.trim()).filter(Boolean)), [values]);
  const savedSigners = useMemo(
    () => entries
      .filter((entry) => entry.subjectType === 'signer' && entry.address !== masterAccountId && !selected.has(entry.address))
      .sort((left, right) => left.label.localeCompare(right.label) || left.address.localeCompare(right.address)),
    [entries, masterAccountId, selected],
  );

  return (
    <div className="mt-4">
      <div className="flex min-h-8 justify-end">
        {privateUnlocked && savedSigners.length > 0 ? (
          <select
            aria-label="Add saved signer"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) onChange(addSavedSignerRow(values, event.target.value));
              event.currentTarget.value = '';
            }}
            className="max-w-full rounded-lg border border-black/10 bg-transparent px-2.5 py-1.5 text-xs font-semibold text-neutral-600 outline-none dark:border-white/10 dark:text-neutral-300"
          >
            <option value="">Saved signers…</option>
            {savedSigners.map((entry) => <option key={entry.address} value={entry.address}>{entry.label} · {shortAddress(entry.address)}</option>)}
          </select>
        ) : !privateUnlocked ? (
          <button type="button" disabled={authBusy} onClick={() => void unlock()} className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-semibold text-neutral-500 disabled:opacity-50 dark:border-white/10 dark:text-neutral-400">{authBusy ? 'Confirming…' : 'Show saved signers'}</button>
        ) : null}
      </div>

      <div className="mt-2 space-y-3">
        {values.map((value, index) => {
          const normalized = value.trim();
          const trailing = index === values.length - 1 && !normalized;
          const valid = Boolean(normalized && isValidStellarAccountId(normalized));
          const label = valid ? labelFor(normalized, 'signer') : '';
          return (
            <div key={index}>
              <div className="flex items-center gap-2">
                <input
                  value={value}
                  onChange={(event) => onChange(updateSignerInputRows(values, index, event.target.value))}
                  aria-label={`Signer address ${index + 1}`}
                  placeholder={trailing ? 'Add signer · G...' : 'G... signer address'}
                  spellCheck={false}
                  className={`min-w-0 flex-1 rounded-xl border bg-transparent px-3 py-3 font-mono text-sm outline-none ${errors[index] ? 'border-amber-500/60' : 'border-black/10 focus:border-emerald-500 dark:border-white/10'}`}
                />
                {!trailing && (
                  <button
                    type="button"
                    onClick={() => onChange(removeSignerInputRow(values, index))}
                    className="rounded-xl border border-black/10 p-3 opacity-55 hover:opacity-100 dark:border-white/10"
                    aria-label={`Remove signer ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              {errors[index] ? (
                <div className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">{errors[index]}</div>
              ) : valid ? (
                <div className="mt-1.5 flex min-h-7 flex-wrap items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  {label && <span className="font-semibold text-neutral-700 dark:text-neutral-200">{label}</span>}
                  <AddressAliasEditor address={normalized} subjectType="signer" compact={Boolean(label)} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
