import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { BookUser, CircleAlert, LoaderCircle, Plus, ShieldCheck, WalletCards } from 'lucide-react';
import AddressAliasEditor from './AddressAliasEditor';
import { PageHeader } from './MultiSigUi';
import { useAddressBook } from './AddressBookContext';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { isValidStellarAccountId } from '../packages/stellar-core/src/horizon';
import { loadAccountsForSigner, peekAccountsForSigner } from '../packages/stellar-core/src/signerAccounts';
import { hasSharedSigningControl } from '../packages/stellar-core/src/treasuryModel';
import type { StellarAccountSnapshot } from '../packages/stellar-core/src/types';
import { cachedTreasuryNames, loadSharedTreasuryNames } from './treasuryMetadataCache';
import { treasuryDisplayLabel } from './treasuryDisplay';
import { stellarHrefWithSearch } from './workspaceNavigation';

interface RelatedSigner {
  address: string;
}

function relatedSigners(accounts: StellarAccountSnapshot[]): RelatedSigner[] {
  const addresses = new Set<string>();
  for (const account of accounts) {
    if (!hasSharedSigningControl(account)) continue;
    for (const signer of account.signers) {
      if (signer.type === 'ed25519_public_key' && signer.weight > 0) addresses.add(signer.key);
    }
  }
  return [...addresses].sort((left, right) => left.localeCompare(right)).map((address) => ({ address }));
}

export default function AddressBookApp() {
  const { address, network, busy, connect, privateUnlocked, authBusy, unlock } = useStellarWallet();
  const { entries, labelFor, saveAlias, loading: aliasesLoading, error: aliasError } = useAddressBook();
  const [accounts, setAccounts] = useState<StellarAccountSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [treasuryNames, setTreasuryNames] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');

  useEffect(() => {
    if (!address || !network) {
      setAccounts([]);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const cached = peekAccountsForSigner(address, network);
    if (cached) {
      setAccounts(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError('');
    void loadAccountsForSigner(address, network, controller.signal)
      .then((items) => { if (!cancelled) setAccounts(items); })
      .catch((cause) => {
        if (!cancelled && !controller.signal.aborted) {
          if (!cached) setAccounts([]);
          setError(cause instanceof Error ? cause.message : 'Unable to refresh related Stellar accounts.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [address, network]);

  const treasuryAccounts = useMemo(
    () => accounts.filter(hasSharedSigningControl).sort((left, right) => left.accountId.localeCompare(right.accountId)),
    [accounts],
  );
  const treasuryIds = useMemo(() => treasuryAccounts.map((account) => account.accountId), [treasuryAccounts]);
  const treasuryIdSet = useMemo(() => new Set(treasuryIds), [treasuryIds]);

  useEffect(() => {
    if (!network) {
      setTreasuryNames({});
      return;
    }
    setTreasuryNames(cachedTreasuryNames(sessionStorage, network, treasuryIds));
    if (!privateUnlocked || !address || treasuryIds.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    void loadSharedTreasuryNames(treasuryIds, network, address, controller.signal)
      .then((names) => { if (!cancelled) setTreasuryNames((current) => ({ ...current, ...names })); })
      .catch(() => undefined);
    return () => { cancelled = true; controller.abort(); };
  }, [treasuryIds, privateUnlocked, address, network]);

  const signers = useMemo(() => relatedSigners(accounts), [accounts]);
  const contacts = useMemo(() => {
    const signerAddressSet = new Set(signers.map((signer) => signer.address));
    const byAddress = new Map(entries
      .filter((entry) => entry.address !== address && !treasuryIdSet.has(entry.address) && !signerAddressSet.has(entry.address))
      .map((entry) => [entry.address, entry]));
    return [...byAddress.values()]
      .sort((left, right) => labelFor(left.address, 'account').localeCompare(labelFor(right.address, 'account')) || left.address.localeCompare(right.address));
  }, [entries, address, treasuryIdSet, signers, labelFor]);

  async function addAddress(event: FormEvent) {
    event.preventDefault();
    const target = newAddress.trim();
    const name = newName.trim();
    if (!isValidStellarAccountId(target)) {
      setAddError('Enter a valid Stellar G... address.');
      return;
    }
    if (!name) {
      setAddError('Add a name for this address.');
      return;
    }
    setAddError('');
    setNewAddress('');
    setNewName('');
    setAdding(false);
    void saveAlias(target, 'account', name).catch(() => undefined);
  }

  const hasContent = treasuryAccounts.length > 0 || signers.length > 0 || contacts.length > 0;

  return (
    <StellarWorkspaceShell active="address-book" networkContext={network}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">
          <PageHeader
            icon={<BookUser className="h-6 w-6" />}
            title="Address Book"
            description="Names follow an address wherever it appears in MultiSig Tools."
            actions={privateUnlocked ? (
              <button type="button" onClick={() => { setAdding((value) => !value); setAddError(''); }} className="mst-action-secondary">
                <Plus className="h-4 w-4" />Add contact
              </button>
            ) : undefined}
          />

          {!address && (
            <section className="mx-auto max-w-xl py-14 sm:py-20">
              <BookUser className="h-8 w-8 text-neutral-400" />
              <h2 className="mt-5 text-3xl font-bold">Connect a wallet</h2>
              <p className="mt-2 text-base leading-7 text-neutral-600 dark:text-neutral-300">Connect to see treasuries, their signers, and your saved names.</p>
              <button type="button" disabled={busy} onClick={() => void connect()} className="mst-action-primary mt-6 disabled:opacity-50"><WalletCards className="h-4 w-4" />{busy ? 'Opening wallets…' : 'Connect wallet'}</button>
            </section>
          )}

          {address && !privateUnlocked && (
            <section className="mst-address-action-row mt-5">
              <div><div className="font-semibold">Saved names are private</div><p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Public account relationships are available now. Confirm this wallet when you want to load your saved private names.</p></div>
              <button type="button" disabled={authBusy} onClick={() => void unlock()} className="mst-action-secondary shrink-0 disabled:opacity-50">{authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Show saved names</button>
            </section>
          )}

          {privateUnlocked && adding && (
            <form onSubmit={addAddress} className="mst-address-add-form mt-5">
              <div><label htmlFor="address-book-new-address" className="text-sm font-semibold">Contact address</label><input id="address-book-new-address" value={newAddress} onChange={(event) => setNewAddress(event.target.value.trim())} placeholder="G..." spellCheck={false} className="mst-address-control mt-2 w-full font-mono" /></div>
              <div><label htmlFor="address-book-new-name" className="text-sm font-semibold">Name</label><input id="address-book-new-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Alice" maxLength={64} className="mst-address-control mt-2 w-full" /></div>
              <button type="submit" className="mst-action-primary">Save</button>
              {addError && <div className="text-sm text-red-700 dark:text-red-300 sm:col-span-3">{addError}</div>}
            </form>
          )}

          {(error || aliasError) && <div className="mt-5 flex gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error || aliasError}</div>}

          {address && (loading || aliasesLoading) && !hasContent && <div className="flex items-center gap-2 py-10 text-sm text-neutral-500 dark:text-neutral-400"><LoaderCircle className="h-4 w-4 animate-spin" />Loading relationships…</div>}

          {treasuryAccounts.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 text-lg font-bold">Treasuries</h2>
              <div className="mst-address-list">
                {treasuryAccounts.map((account) => {
                  const sharedName = treasuryNames[account.accountId] || '';
                  const personalNote = labelFor(account.accountId, 'account');
                  const displayName = treasuryDisplayLabel(sharedName, personalNote) || 'Unnamed treasury';
                  return (
                    <div key={account.accountId} className="mst-address-row">
                      <div className="min-w-0 flex-1"><div className="font-bold">{displayName}</div><div className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{account.accountId}</div></div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <a href={stellarHrefWithSearch('/new', { account: account.accountId, network })} className="mst-action-primary">New proposal</a>
                        <AddressAliasEditor address={account.accountId} subjectType="account" semantics="note" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {signers.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 text-lg font-bold">Signers</h2>
              <div className="mst-address-list">
                {signers.map((signer) => {
                  const treasuryMaster = treasuryIdSet.has(signer.address);
                  const treasuryLabel = treasuryMaster
                    ? treasuryDisplayLabel(treasuryNames[signer.address] || '', labelFor(signer.address, 'account'))
                    : '';
                  const alias = treasuryMaster ? '' : labelFor(signer.address, 'signer');
                  const displayName = treasuryMaster ? `${treasuryLabel || 'Treasury'} · account key` : alias || 'Unnamed signer';
                  return (
                    <div key={signer.address} className="mst-address-row">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><div className="font-bold">{displayName}</div>{signer.address === address && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Current wallet</span>}</div>
                        <div className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{signer.address}</div>
                      </div>
                      {!treasuryMaster && <AddressAliasEditor address={signer.address} subjectType="signer" />}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {privateUnlocked && contacts.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 text-lg font-bold">Contacts</h2>
              <div className="mst-address-list">
                {contacts.map((entry) => (
                  <div key={entry.address} className="mst-address-row"><div className="min-w-0 flex-1"><div className="font-bold">{labelFor(entry.address, 'account')}</div><div className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{entry.address}</div></div><AddressAliasEditor address={entry.address} subjectType="account" /></div>
                ))}
              </div>
            </section>
          )}

          {address && !loading && !aliasesLoading && !hasContent && !error && (
            <section className="py-12 text-sm text-neutral-500 dark:text-neutral-400">
              Nothing here yet. {privateUnlocked ? 'Add a contact above, or names will appear here as you use them in payments and signing.' : 'Show saved names to add a contact.'}
            </section>
          )}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
