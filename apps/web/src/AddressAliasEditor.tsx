import { useEffect, useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { useAddressBook } from './AddressBookContext';
import type { AddressAliasSubjectType } from './AddressBookContext';
import { useStellarWallet } from './StellarWalletContext';

interface Props {
  address: string;
  subjectType: AddressAliasSubjectType;
  compact?: boolean;
  semantics?: 'name' | 'note';
}

export default function AddressAliasEditor({ address, subjectType, compact = false, semantics = 'name' }: Props) {
  const { privateUnlocked } = useStellarWallet();
  const { labelFor, saveAlias, removeAlias } = useAddressBook();
  const currentLabel = labelFor(address, subjectType);
  const noteMode = semantics === 'note';
  const noun = noteMode ? 'note' : 'name';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentLabel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editing) setDraft(currentLabel);
  }, [currentLabel, editing]);

  function save() {
    const value = draft.trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    setEditing(false);
    void saveAlias(address, subjectType, value)
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : `Unable to save ${noun}.`);
      })
      .finally(() => setBusy(false));
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await removeAlias(address, subjectType);
      setEditing(false);
      setDraft('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to remove ${noun}.`);
    } finally {
      setBusy(false);
    }
  }

  if (!privateUnlocked) return null;

  if (!editing) {
    return (
      <div className="transaction-evidence-human-label inline-flex flex-col items-start">
        <button
          type="button"
          disabled={busy}
          onClick={() => { setDraft(currentLabel); setError(''); setEditing(true); }}
          className={`inline-flex items-center gap-1.5 rounded-lg text-neutral-500 transition hover:bg-black/5 hover:text-black disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white ${compact ? 'p-1.5' : 'px-2.5 py-1.5 text-xs font-semibold'}`}
          aria-label={noteMode ? (currentLabel ? 'Edit personal note' : 'Add personal note') : (currentLabel ? `Rename ${currentLabel}` : `Name this ${subjectType}`)}
          title={noteMode ? 'Personal note visible only to you' : (currentLabel ? 'Rename' : `Give this ${subjectType} a private name`)}
        >
          <Pencil className="h-3.5 w-3.5" />
          {!compact && <span>{noteMode ? (currentLabel ? 'Edit note' : 'Add note') : (currentLabel ? 'Rename' : 'Name this')}</span>}
        </button>
        {error && <div className="mt-1 max-w-[240px] text-xs text-red-700 dark:text-red-300">{error}</div>}
      </div>
    );
  }

  return (
    <div className="transaction-evidence-human-label min-w-[220px]">
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          maxLength={64}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); save(); }
            if (event.key === 'Escape') setEditing(false);
          }}
          placeholder={noteMode ? 'e.g. Payroll account' : subjectType === 'account' ? 'e.g. Vendor' : 'e.g. Bob'}
          className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm outline-none focus:border-emerald-500 dark:border-white/10 dark:bg-[#151515]"
        />
        <button type="button" disabled={busy || !draft.trim()} onClick={save} className="rounded-lg p-2 text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-40 dark:text-emerald-300" aria-label={noteMode ? 'Save note' : 'Save name'}><Check className="h-4 w-4" /></button>
        <button type="button" disabled={busy} onClick={() => setEditing(false)} className="rounded-lg p-2 text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10" aria-label={noteMode ? 'Cancel note' : 'Cancel naming'}><X className="h-4 w-4" /></button>
        {currentLabel && <button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg p-2 text-red-600 hover:bg-red-500/10 disabled:opacity-40" aria-label={noteMode ? 'Remove note' : 'Remove name'}><Trash2 className="h-4 w-4" /></button>}
      </div>
      {error && <div className="mt-1.5 text-xs text-red-700 dark:text-red-300">{error}</div>}
      <div className="mt-1 text-[11px] text-neutral-400">{noteMode ? 'Personal note · private to you. It never changes the shared Treasury name.' : 'Private to your MultiSig Tools address book.'}</div>
    </div>
  );
}
