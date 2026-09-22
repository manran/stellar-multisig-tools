import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { useAddressBook } from './AddressBookContext';
import { useStellarWallet } from './StellarWalletContext';
import { analyzeAccountAuthorization } from '../../../packages/stellar-core/src/authorization';
import { humanAuthorizationRequirement } from './stellar/authorizationPresentation';
import { isValidStellarAccountId } from '../../../packages/stellar-core/src/horizon';
import { loadAccountsForSigner, peekAccountsForSigner } from '../../../packages/stellar-core/src/signerAccounts';
import { hasSharedSigningControl } from '../../../packages/stellar-core/src/treasuryModel';
import type { StellarAccountSnapshot, StellarNetwork } from '../../../packages/stellar-core/src/types';
import { cachedTreasuryName } from './treasuryMetadataCache';

function shortAddress(address: string) {
  return address.length <= 18 ? address : `${address.slice(0, 7)}…${address.slice(-6)}`;
}

interface Props {
  id: string;
  label: string;
  network: StellarNetwork;
  value: string;
  onChange: (accountId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  sharedControlOnly?: boolean;
}

export default function SigningAccountPicker({ id, label, network, value, onChange, disabled = false, placeholder = 'G... account', sharedControlOnly = false }: Props) {
  const { sessionAddress, privateUnlocked } = useStellarWallet();
  const { labelFor } = useAddressBook();
  const [accounts, setAccounts] = useState<StellarAccountSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState(!sessionAddress);
  const focusClass = network === 'testnet' ? 'focus:border-sky-500' : 'focus:border-emerald-500';
  const actionClass = network === 'testnet' ? 'text-sky-700 hover:text-sky-800 dark:text-sky-300' : 'text-emerald-700 hover:text-emerald-800 dark:text-emerald-300';
  const visible = (items: StellarAccountSnapshot[]) => sharedControlOnly ? items.filter(hasSharedSigningControl) : items;

  useEffect(() => {
    if (!sessionAddress) { setAccounts([]); setManual(true); setLoading(false); return; }
    let cancelled = false;
    const controller = new AbortController();
    const cached = peekAccountsForSigner(sessionAddress, network);
    if (cached) {
      const items = visible(cached);
      setAccounts(items); setManual(items.length === 0); setLoading(false);
      if ((!value || !items.some((account) => account.accountId === value)) && items.length === 1) onChange(items[0].accountId);
    } else setLoading(true);
    setError('');
    void loadAccountsForSigner(sessionAddress, network, controller.signal)
      .then((items) => {
        if (cancelled) return;
        const next = visible(items); setAccounts(next);
        if (next.length === 0) { setManual(true); return; }
        setManual(false);
        if (!value || !next.some((account) => account.accountId === value)) onChange(next.length === 1 ? next[0].accountId : '');
      })
      .catch((cause) => {
        if (cancelled || controller.signal.aborted) return;
        if (!cached) { setAccounts([]); setManual(true); }
        setError(cause instanceof Error ? cause.message : 'Unable to load your accounts.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [sessionAddress, network, sharedControlOnly]);

  const selectedAccount = useMemo(() => accounts.find((account) => account.accountId === value) ?? null, [accounts, value]);
  const selectedPolicy = useMemo(() => selectedAccount ? analyzeAccountAuthorization(selectedAccount) : null, [selectedAccount]);
  const sharedName = selectedAccount && privateUnlocked && sharedControlOnly ? cachedTreasuryName(sessionStorage, network, selectedAccount.accountId) : '';
  const ordinaryAlias = selectedAccount && !sharedControlOnly ? labelFor(selectedAccount.accountId, 'account') : '';
  const selectedName = sharedName || ordinaryAlias || (sharedControlOnly ? 'Treasury' : 'Account');

  return <div>
    <div className="flex items-center justify-between gap-3"><label htmlFor={id} className="text-sm font-semibold">{label}</label>{loading && accounts.length === 0 && <span className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Loading accounts</span>}</div>
    {!manual && accounts.length > 0 ? <>
      {accounts.length > 1 && <div className="relative mt-2"><select id={id} value={value} disabled={disabled || loading} onChange={(event) => onChange(event.target.value)} className={`w-full appearance-none rounded-xl border border-black/10 bg-white px-4 py-3 pr-10 text-sm font-semibold outline-none disabled:opacity-50 dark:border-white/10 dark:bg-white/5 ${focusClass}`}><option value="">{sharedControlOnly ? 'Choose a treasury' : 'Choose an account'}</option>{accounts.map((account) => { const name = privateUnlocked && sharedControlOnly ? cachedTreasuryName(sessionStorage, network, account.accountId) : ''; const alias = !sharedControlOnly ? labelFor(account.accountId, 'account') : ''; return <option key={account.accountId} value={account.accountId}>{name || alias || shortAddress(account.accountId)}</option>; })}</select><ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" /></div>}
      {selectedAccount && selectedPolicy && <div className={`${accounts.length > 1 ? 'mt-3' : 'mt-2'} rounded-xl border border-black/10 bg-black/[0.018] px-4 py-3 dark:border-white/10 dark:bg-white/[0.025]`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="font-semibold">{selectedName}</div><div className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{selectedAccount.accountId}</div></div><div className="shrink-0 text-right text-xs text-neutral-500 dark:text-neutral-400"><div className="font-semibold text-neutral-700 dark:text-neutral-200">{humanAuthorizationRequirement(selectedPolicy.thresholds.medium)}</div><div className="mt-1">{selectedAccount.nativeBalance} XLM</div></div></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-2 text-xs text-neutral-500 dark:border-white/10 dark:text-neutral-400"><span>{selectedAccount.accountId === sessionAddress ? 'This is your current Stellar account.' : sharedControlOnly ? 'Your current wallet is an active signer for this Treasury.' : 'Your current wallet is an active signer for this account.'}</span><button type="button" disabled={disabled} onClick={() => setManual(true)} className={`text-sm font-semibold disabled:opacity-50 ${actionClass}`}>Use another account</button></div></div>}
    </> : <><input id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value.trim())} placeholder={placeholder} spellCheck={false} className={`mt-2 w-full rounded-xl border border-black/10 bg-transparent px-4 py-3 font-mono text-sm outline-none disabled:opacity-50 dark:border-white/10 ${focusClass}`} />{accounts.length > 0 && <button type="button" disabled={disabled} onClick={() => { setManual(false); if (!accounts.some((account) => account.accountId === value)) onChange(accounts.length === 1 ? accounts[0].accountId : ''); }} className={`mt-2 text-sm font-semibold disabled:opacity-50 ${actionClass}`}>{sharedControlOnly ? (accounts.length === 1 ? 'Use detected treasury' : 'Choose from detected treasuries') : (accounts.length === 1 ? 'Use detected account' : 'Choose from detected accounts')}</button>}</>}
    {value && !isValidStellarAccountId(value) && <div className="mt-2 text-sm text-red-700 dark:text-red-300">Enter a valid Stellar G... account.</div>}
    {error && <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">Your account list could not be refreshed. Cached or manual account selection remains available.</div>}
  </div>;
}
