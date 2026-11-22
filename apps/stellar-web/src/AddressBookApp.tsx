import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { CircleAlert, LoaderCircle, Plus } from 'lucide-react';
import AddressAliasEditor from './AddressAliasEditor';
import { PageHeader } from './MultiSigUi';
import { useAddressBook } from './AddressBookContext';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import ToolAccessEntry from './ToolAccessEntry';
import { useStellarWallet } from './StellarWalletContext';
import { useUserIdentity } from './UserIdentityContext';
import { isValidStellarAccountId } from '../../../packages/stellar-core/src/horizon';
import { loadAccountsForSigner, peekAccountsForSigner } from '../../../packages/stellar-core/src/signerAccounts';
import { hasSharedSigningControl } from '../../../packages/stellar-core/src/treasuryModel';
import type { StellarAccountSnapshot } from '../../../packages/stellar-core/src/types';
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
  const { address, network, privateUnlocked, unlockedAddress, unlockedNetwork } = useStellarWallet();
  const { identity } = useUserIdentity();
  const { entries, labelFor, saveAlias, loading: aliasesLoading, error: aliasError } = useAddressBook();
  const [accounts, setAccounts] = useState<StellarAccountSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [treasuryNames, setTreasuryNames] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [search, setSearch] = useState('');
  const privateReady = Boolean(identity);
  const treasuryPrivateReady = Boolean(privateUnlocked && address && network && unlockedAddress === address && unlockedNetwork === network && identity);
  const visibleLabelFor = (identity: string, type: 'account' | 'signer') => privateReady ? labelFor(identity, type) : '';
  const visibleTreasuryNames = privateReady ? treasuryNames : {};

  useEffect(() => {
    setAdding(false);
    setNewAddress('');
    setNewName('');
    setAddError('');
    setSearch('');
  }, [address, network]);

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
    if (!treasuryPrivateReady || !network || !address) {
      setTreasuryNames({});
      return;
    }
    setTreasuryNames(cachedTreasuryNames(sessionStorage, network, treasuryIds));
    if (treasuryIds.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    void loadSharedTreasuryNames(treasuryIds, network, address, controller.signal)
      .then((names) => { if (!cancelled) setTreasuryNames((current) => ({ ...current, ...names })); })
      .catch(() => undefined);
    return () => { cancelled = true; controller.abort(); };
  }, [treasuryIds, treasuryPrivateReady, address, network]);

  const signers = useMemo(() => relatedSigners(accounts), [accounts]);
  const contacts = useMemo(() => {
    const signerAddressSet = new Set(signers.map((signer) => signer.address));
    const byAddress = new Map(entries
      .filter((entry) => entry.address !== address && !treasuryIdSet.has(entry.address) && !signerAddressSet.has(entry.address))
      .map((entry) => [entry.address, entry]));
    return [...byAddress.values()]
      .sort((left, right) => (privateReady ? labelFor(left.address, 'account') : '').localeCompare((privateReady ? labelFor(right.address, 'account') : '')) || left.address.localeCompare(right.address));
  }, [entries, address, treasuryIdSet, signers, labelFor, privateReady]);

  async function addAddress(event: FormEvent) {
    event.preventDefault();
    if (savingContact) return;
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
    setSavingContact(true);
    setAddError('');
    try {
      await saveAlias(target, 'account', name);
      setNewAddress('');
      setNewName('');
      setAdding(false);
    } catch (cause) {
      setAddError(cause instanceof Error ? cause.message : 'Could not save this contact.');
    } finally {
      setSavingContact(false);
    }
  }

  const query = search.trim().toLowerCase();
  const matches = (account: string, name: string) =>
    !query || account.toLowerCase().includes(query) || name.toLowerCase().includes(query);
  const visibleSigners = signers.filter((signer) =>
    matches(signer.address, visibleLabelFor(signer.address, 'signer') + ' ' + visibleLabelFor(signer.address, 'account') + ' ' + (visibleTreasuryNames[signer.address] ?? '')));
  const visibleContacts = privateReady ? contacts.filter((entry) => matches(entry.address, visibleLabelFor(entry.address, 'account'))) : [];
  const visibleTreasuries = treasuryAccounts.filter((account) =>
    matches(account.accountId, treasuryDisplayLabel(visibleTreasuryNames[account.accountId] || '', visibleLabelFor(account.accountId, 'account'))));
  const visibleCount = visibleSigners.length + visibleContacts.length + visibleTreasuries.length;

  const hasContent = treasuryAccounts.length > 0 || signers.length > 0 || (privateReady && contacts.length > 0);

  return (
    <StellarWorkspaceShell active="address-book" networkContext={network}>
      <main className="mst-workbench-page">
        <div className="mx-auto max-w-6xl">
          <PageHeader
            title="Contacts"
            description="Save signer names and invitation emails."
            actions={privateReady ? (
              <button type="button" aria-expanded={adding} onClick={() => { setAdding((value) => !value); setAddError(''); }} className="mst-action-secondary">
                <Plus className="h-4 w-4" />Add contact
              </button>
            ) : undefined}
          />

          {!identity && <ToolAccessEntry returnTo="/address-book" />}

          {privateReady && adding && (
            <form onSubmit={addAddress} className="mst-address-add-form mt-5">
              <div><label htmlFor="address-book-new-address" className="text-sm font-semibold">Contact address</label><input id="address-book-new-address" value={newAddress} onChange={(event) => setNewAddress(event.target.value.trim())} placeholder="G..." spellCheck={false} className="mst-address-control mt-2 w-full font-mono" /></div>
              <div><label htmlFor="address-book-new-name" className="text-sm font-semibold">Name</label><input id="address-book-new-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Alice" maxLength={64} className="mst-address-control mt-2 w-full" /></div>
              <div className="mst-contacts-form-actions">
                <button type="submit" disabled={savingContact} className="mst-action-primary">{savingContact ? 'Saving…' : 'Save contact'}</button>
                <button type="button" disabled={savingContact} className="mst-action-secondary" onClick={() => { setAdding(false); setAddError(''); }}>Cancel</button>
              </div>
              {addError && <div className="text-sm text-red-700 dark:text-red-300 sm:col-span-3">{addError}</div>}
            </form>
          )}

          {(error || aliasError) && <div className="mt-5 flex gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error || aliasError}</div>}

          {privateReady && (loading || aliasesLoading) && !hasContent && <div className="flex items-center gap-2 py-10 text-sm text-neutral-500 dark:text-neutral-400"><LoaderCircle className="h-4 w-4 animate-spin" />Loading relationships…</div>}

          {privateReady && hasContent && (
            <div className="mst-contacts-search">
              <label htmlFor="contact-search">Find a contact</label>
              <input id="contact-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or Stellar address" className="mst-address-control" />
              <span aria-live="polite">{visibleCount} shown</span>
            </div>
          )}
          {privateReady && query && visibleCount === 0 && hasContent && (
            <p role="status" className="mt-6 text-sm text-[var(--color-ink-2)]">No matching contacts. Try another name or address.</p>
          )}

          {visibleSigners.length > 0 && (
            <section className="mst-contacts-section">
              <div className="mst-operations-section-head"><h2>Signers <span className="mst-operations-count">{visibleSigners.length}</span></h2><p>People and accounts authorized to sign. Add names and email addresses for invitations.</p></div>
              <div className="mst-address-list">
                {visibleSigners.map((signer) => {
                  const treasuryMaster = treasuryIdSet.has(signer.address);
                  const treasuryLabel = treasuryMaster
                    ? treasuryDisplayLabel(visibleTreasuryNames[signer.address] || '', visibleLabelFor(signer.address, 'account'))
                    : '';
                  const alias = treasuryMaster ? '' : visibleLabelFor(signer.address, 'signer');
                  const displayName = treasuryMaster ? `${treasuryLabel || 'Treasury'} · account key` : alias || 'Unnamed signer';
                  return (
                    <div key={signer.address} className="mst-address-row">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><div className="font-bold">{displayName}</div>{signer.address === address && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Current wallet</span>}</div>
                        <div className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{signer.address}</div>
                      </div>
                      {!treasuryMaster && <AddressAliasEditor address={signer.address} subjectType="signer" allowNotificationEmail />}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {privateReady && visibleContacts.length > 0 && (
            <section className="mst-contacts-section">
              <div className="mst-operations-section-head"><h2>Saved contacts <span className="mst-operations-count">{visibleContacts.length}</span></h2><p>Other addresses saved for future payments and proposals.</p></div>
              <div className="mst-address-list">
                {visibleContacts.map((entry) => (
                  <div key={entry.address} className="mst-address-row"><div className="min-w-0 flex-1"><div className="font-bold">{visibleLabelFor(entry.address, 'account')}</div><div className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{entry.address}</div></div><AddressAliasEditor address={entry.address} subjectType="account" /></div>
                ))}
              </div>
            </section>
          )}

          {visibleTreasuries.length > 0 && (
            <section className="mst-contacts-section">
              <div className="mst-operations-section-head"><h2>Treasuries <span className="mst-operations-count">{visibleTreasuries.length}</span></h2><p>Accounts linked to your signers.</p></div>
              <div className="mst-address-list">
                {visibleTreasuries.map((account) => {
                  const sharedName = visibleTreasuryNames[account.accountId] || '';
                  const personalNote = visibleLabelFor(account.accountId, 'account');
                  const displayName = treasuryDisplayLabel(sharedName, personalNote) || 'Unnamed treasury';
                  return (
                    <div key={account.accountId} className="mst-address-row">
                      <div className="min-w-0 flex-1"><div className="font-bold">{displayName}</div><div className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{account.accountId}</div></div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <a href={stellarHrefWithSearch('/new', { account: account.accountId, network })} className="mst-action-secondary">New proposal</a>
                        <AddressAliasEditor address={account.accountId} subjectType="account" semantics="note" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {privateReady && !loading && !aliasesLoading && !hasContent && !error && (
            <section className="py-12 text-sm text-neutral-500 dark:text-neutral-400">
              No contacts yet. Add one above.
            </section>
          )}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
