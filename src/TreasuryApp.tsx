import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CircleAlert,
  ClipboardCopy,
  LoaderCircle,
  Plus,
  Settings2,
  ShieldCheck,
  Vault,
  WalletCards,
} from 'lucide-react';
import AddressAliasEditor from './AddressAliasEditor';
import { PageHeader } from './MultiSigUi';
import { useAddressBook } from './AddressBookContext';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { analyzeAccountAuthorization } from './stellar/authorization';
import { approvalPowerLabel, humanAuthorizationRequirement } from './stellar/authorizationPresentation';
import { accountAssetPresentations, assetBalanceParts, compactAssetIssuer } from './stellar/assetPresentation';
import { loadAccount } from './stellar/horizon';
import { loadAccountsForSigner, peekAccountsForSigner } from './stellar/signerAccounts';
import { classifyTreasuryRelationship } from './stellar/treasuryModel';
import {
  loadAdoptedTreasuryAccountIds,
  loadTreasuryOnboardingDismissed,
  saveAdoptedTreasuryAccountIds,
  saveTreasuryOnboardingDismissed,
} from './stellar/treasuryPreferences';
import type { StellarAccountSnapshot, StellarNetwork } from './stellar/types';
import { cachedTreasuryNames, loadSharedTreasuryNames } from './treasuryMetadataCache';
import {
  parseTreasuryRoute,
  treasuryActivityHref,
  treasuryOverviewHref,
  treasurySettingsHref,
  treasurySigningHref,
} from './treasuryNavigation';
import { stellarHref } from './workspaceNavigation';

function TreasuryCard({
  account,
  network,
  name,
  nameReady,
  suggested = false,
  onAdopt,
}: {
  account: StellarAccountSnapshot;
  network: StellarNetwork;
  name?: string;
  nameReady: boolean;
  suggested?: boolean;
  onAdopt?: () => void;
}) {
  const analysis = analyzeAccountAuthorization(account);
  const signerCount = account.signers.filter((signer) => signer.type === 'ed25519_public_key' && signer.weight > 0).length;

  return (
    <article className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a href={treasuryOverviewHref(account.accountId, network)} className="text-lg font-bold hover:underline hover:decoration-black/20 hover:underline-offset-4 dark:hover:decoration-white/20">
              {name || (suggested ? 'Multisig account' : nameReady ? 'Unnamed treasury' : 'Treasury')}
            </a>
            {suggested && <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">You can manage this account</span>}
          </div>
          <div className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{account.accountId}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-bold">{account.nativeBalance} XLM</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">Native balance</div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 border-t border-black/10 pt-4 text-sm dark:border-white/10 sm:grid-cols-3">
        <div><div className="text-xs text-neutral-500 dark:text-neutral-400">Signers</div><div className="mt-1 font-semibold">{signerCount}</div></div>
        <div><div className="text-xs text-neutral-500 dark:text-neutral-400">Standard transactions</div><div className="mt-1 font-semibold">{humanAuthorizationRequirement(analysis.thresholds.medium)}</div></div>
        <div><div className="text-xs text-neutral-500 dark:text-neutral-400">Core account control</div><div className="mt-1 font-semibold">{humanAuthorizationRequirement(analysis.thresholds.high)}</div></div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 border-t border-black/10 pt-4 text-sm font-semibold dark:border-white/10">
        {suggested && onAdopt ? (
          <button type="button" onClick={onAdopt} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-white hover:bg-emerald-800"><Plus className="h-4 w-4" />Use as Treasury</button>
        ) : (
          <a href={treasuryOverviewHref(account.accountId, network)} className="rounded-xl border border-black/10 px-3 py-2 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10">Open treasury</a>
        )}
      </div>
    </article>
  );
}

function TreasuryAssets({ assets }: { assets: ReturnType<typeof accountAssetPresentations> }) {
  const [copiedIssuer, setCopiedIssuer] = useState('');

  async function copyIssuer(issuer: string) {
    try {
      await navigator.clipboard.writeText(issuer);
      setCopiedIssuer(issuer);
      window.setTimeout(() => setCopiedIssuer((current) => current === issuer ? '' : current), 1500);
    } catch {
      // Clipboard access is optional; keep the full issuer available through title text.
    }
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Assets</h2>
        <span className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">{assets.length} {assets.length === 1 ? 'asset' : 'assets'} on this account</span>
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-neutral-200/80 dark:border-white/[0.08]">
        {assets.map((asset) => {
          const balance = assetBalanceParts(asset.balance);
          return (
            <div key={asset.key} className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200/80 px-4 py-3.5 last:border-b-0 dark:border-white/[0.08]">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{asset.code}</div>
                {asset.kind === 'native'
                  ? <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Native Stellar asset</div>
                  : <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                      <span>Issuer <span className="font-mono" title={asset.issuer}>{compactAssetIssuer(asset.issuer ?? '')}</span></span>
                      <button type="button" onClick={() => void copyIssuer(asset.issuer ?? '')} className="inline-flex items-center gap-1 font-semibold text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white" aria-label={`Copy issuer ${asset.issuer}`}>
                        <ClipboardCopy className="h-3 w-3" />{copiedIssuer === asset.issuer ? 'Copied' : 'Copy'}
                      </button>
                    </div>}
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm font-semibold tabular-nums"><span>{balance.integer}</span><span className="opacity-55">{balance.fraction}</span></div>
                <div className="mt-0.5 text-xs text-neutral-400">Balance</div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Issued assets are identified by both asset code and issuer. Unknown issuers remain visible; metadata never replaces the on-chain identity.</p>
    </div>
  );
}

function PersonalAccountPrompt({
  account,
  network,
  onDismiss,
}: {
  account: StellarAccountSnapshot;
  network: StellarNetwork;
  onDismiss: () => void;
}) {
  return (
    <article className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Create a treasury</div><h2 className="mt-2 text-lg font-bold">Turn this account into a shared-control treasury</h2></div>
        <button type="button" onClick={onDismiss} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10">Dismiss guide</button>
      </div>
      <div className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{account.accountId}</div>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">Add other signers and choose how many approvals are required for payments and account changes.</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <a href={treasurySigningHref(account.accountId, network, 'create-treasury')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"><Plus className="h-4 w-4" />Create treasury</a>
        <a href={stellarHref('/account/signing') + '?mode=offline'} className="text-sm font-semibold text-neutral-500 underline decoration-black/15 underline-offset-4 hover:text-black dark:text-neutral-400 dark:hover:text-white">Set up multisig offline</a>
      </div>
    </article>
  );
}

function CompactCreateTreasury({ account, network }: { account: StellarAccountSnapshot; network: StellarNetwork }) {
  return (
    <article className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-black/10 bg-white px-4 py-4 dark:border-white/10 dark:bg-white/[0.03] sm:px-5">
      <div><div className="font-semibold">Create a treasury</div><p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Setup guide dismissed. The create action stays available here.</p></div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <a href={treasurySigningHref(account.accountId, network, 'create-treasury')} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-2.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><Plus className="h-4 w-4" />Create treasury</a>
        <a href={stellarHref('/account/signing') + '?mode=offline'} className="text-xs font-semibold text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white">Set up multisig offline</a>
      </div>
    </article>
  );
}

function OtherControlledAccount({ account, onAdopt }: { account: StellarAccountSnapshot; onAdopt: () => void }) {
  return (
    <article className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03] sm:p-6">
      <div className="text-sm font-semibold">Other controlled account</div>
      <div className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{account.accountId}</div>
      <p className="mt-3 text-sm leading-6 text-neutral-500 dark:text-neutral-400">This wallet can authorize the account, but its current policy is not an obvious shared-control treasury. Add it only if you intentionally want to manage it here.</p>
      <button type="button" onClick={onAdopt} className="mt-4 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10">Use as treasury</button>
    </article>
  );
}

function TreasuryDetail({
  account,
  network,
  adopted,
  name,
  nameReady,
  relationship,
  onAdopt,
}: {
  account: StellarAccountSnapshot;
  network: StellarNetwork;
  adopted: boolean;
  name?: string;
  nameReady: boolean;
  relationship: ReturnType<typeof classifyTreasuryRelationship>;
  onAdopt: () => void;
}) {
  const { labelFor } = useAddressBook();
  const analysis = analyzeAccountAuthorization(account);
  const reusableSigners = account.signers.filter((signer) => signer.type === 'ed25519_public_key' && signer.weight > 0);
  const advancedSigners = account.signers.filter((signer) => signer.type !== 'ed25519_public_key' && signer.weight > 0);
  const assets = accountAssetPresentations(account);
  return (
    <>
      <a href={treasuryOverviewHref()} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" />Treasury
      </a>
      <section className="mt-5 rounded-3xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-5 border-b border-black/10 pb-5 dark:border-white/10">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{name || (adopted ? (nameReady ? 'Unnamed treasury' : 'Treasury') : 'Account')}</h1>
              {adopted && nameReady && <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-neutral-500 dark:bg-white/10 dark:text-neutral-300">Shared Treasury name</span>}
              {!adopted && relationship === 'suggested_treasury' && <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">You can manage this account</span>}
            </div>
            <div className="mt-1 break-all font-mono text-sm text-neutral-600 dark:text-neutral-300">{account.accountId}</div>
            {!adopted && relationship === 'personal_account' && <a href={treasurySigningHref(account.accountId, network, 'create-treasury')} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />Create treasury</a>}
            {!adopted && relationship !== 'personal_account' && <button type="button" onClick={onAdopt} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><Plus className="h-4 w-4" />Use as Treasury</button>}
          </div>
          <div className="shrink-0 text-right"><div className="text-xl font-bold">{assets.length} {assets.length === 1 ? 'asset' : 'assets'}</div><div className="text-xs text-neutral-500 dark:text-neutral-400">Treasury holdings</div></div>
        </div>

        <TreasuryAssets assets={assets} />

        <div className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-bold">Signing policy</h2><span className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">Total approval power {analysis.totalActiveWeight}</span></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-black/[0.035] p-4 dark:bg-white/[0.04]"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Limited account actions</div><div className="mt-2 text-lg font-bold leading-6">{humanAuthorizationRequirement(analysis.thresholds.low)}</div></div>
            <div className="rounded-2xl bg-black/[0.035] p-4 dark:bg-white/[0.04]"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Standard transactions</div><div className="mt-2 text-lg font-bold leading-6">{humanAuthorizationRequirement(analysis.thresholds.medium)}</div></div>
            <div className="rounded-2xl bg-black/[0.035] p-4 dark:bg-white/[0.04]"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Core account control</div><div className="mt-2 text-lg font-bold leading-6">{humanAuthorizationRequirement(analysis.thresholds.high)}</div></div>
            <div className="rounded-2xl bg-black/[0.035] p-4 dark:bg-white/[0.04]"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Account key</div><div className="mt-2 text-lg font-bold leading-6">{approvalPowerLabel(analysis.masterKeyWeight)}</div></div>
          </div>
        </div>

        <div className="mt-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-bold">Signers</h2><span className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">{reusableSigners.length} active signing {reusableSigners.length === 1 ? 'key' : 'keys'}</span></div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-black/10 dark:border-white/10">
            {reusableSigners.map((signer) => {
              const isAccountKey = signer.key === account.accountId;
              const signerAlias = isAccountKey ? '' : labelFor(signer.key, 'signer');
              return <div key={signer.key} className="flex flex-wrap items-center gap-3 border-b border-black/5 px-4 py-3.5 last:border-b-0 dark:border-white/10"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><div className="text-sm font-semibold">{signerAlias || (isAccountKey ? 'Account key' : 'Signer')}</div>{!isAccountKey && <AddressAliasEditor address={signer.key} subjectType="signer" compact={Boolean(signerAlias)} />}</div><div className="mt-0.5 break-all font-mono text-xs text-neutral-600 dark:text-neutral-300">{signer.key}</div></div><div className="rounded-lg bg-black/[0.04] px-2.5 py-1.5 font-mono text-xs font-semibold dark:bg-white/[0.06]">approval power {signer.weight}</div></div>;
            })}
            {reusableSigners.length === 0 && <div className="px-4 py-4 text-sm text-neutral-500 dark:text-neutral-400">No active signing keys.</div>}
          </div>
        </div>

        {advancedSigners.length > 0 && <details className="mt-5 rounded-xl border border-black/10 p-4 dark:border-white/10"><summary className="cursor-pointer text-sm font-semibold">Advanced signer types · {advancedSigners.length}</summary><div className="mt-3 space-y-2 text-sm text-neutral-600 dark:text-neutral-300">{advancedSigners.map((signer) => <div key={signer.key} className="break-all font-mono text-xs">{signer.type} · {signer.key} · weight {signer.weight}</div>)}</div></details>}

        {adopted && (
          <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-black/10 pt-5 dark:border-white/10">
            <p className="max-w-2xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">Review Treasury history first. Signers, approval rules, Audit access, and other administrative controls live under Settings.</p>
            <div className="flex flex-wrap items-center gap-2">
              <a href={treasuryActivityHref(account.accountId, network)} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10">Activity</a>
              <a href={treasurySettingsHref(account.accountId, network)} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"><Settings2 className="h-4 w-4" />Settings</a>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

export default function TreasuryApp() {
  const { address, network: connectedNetwork, networkSource, busy, connect, privateUnlocked, authBusy, unlock, unlockedAddress, unlockedNetwork } = useStellarWallet();
  const route = parseTreasuryRoute(window.location.search);
  const network = networkSource === 'application' && route.network ? route.network : connectedNetwork;
  const [accounts, setAccounts] = useState<StellarAccountSnapshot[]>([]);
  const [adoptedIds, setAdoptedIds] = useState<string[]>([]);
  const [treasuryOnboardingDismissed, setTreasuryOnboardingDismissed] = useState(false);
  const [treasuryNames, setTreasuryNames] = useState<Record<string, string>>({});
  const [treasuryMetadataReady, setTreasuryMetadataReady] = useState(false);
  const privateReady = Boolean(privateUnlocked && address && network && unlockedAddress === address && unlockedNetwork === network);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const accountParam = route.accountId;
  const routeNetworkMismatch = Boolean(route.network && connectedNetwork && networkSource === 'wallet' && route.network !== connectedNetwork);
  const selected = accountParam ? accounts.find((account) => account.accountId === accountParam) ?? null : null;

  useEffect(() => {
    if (!address || !network) {
      setAdoptedIds([]);
      return;
    }
    setAdoptedIds(loadAdoptedTreasuryAccountIds(localStorage, address, network));
  }, [address, network]);

  useEffect(() => {
    if (!address || !network) {
      setTreasuryOnboardingDismissed(false);
      return;
    }
    setTreasuryOnboardingDismissed(loadTreasuryOnboardingDismissed(localStorage, address, network));
  }, [address, network]);

  useEffect(() => {
    if (!address || !network) {
      setAccounts([]);
      setLoading(false);
      setError('');
      return;
    }
    if (routeNetworkMismatch) {
      setAccounts([]);
      setLoading(false);
      setError(`This Treasury link is for ${route.network === 'testnet' ? 'Testnet' : 'Mainnet'}, but the connected wallet is using ${connectedNetwork === 'testnet' ? 'Testnet' : 'Mainnet'}.`);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setError('');
    const cachedAccounts = peekAccountsForSigner(address, network);
    const cachedSelected = accountParam ? cachedAccounts?.find((account) => account.accountId === accountParam) ?? null : null;
    if (accountParam && cachedSelected) {
      setAccounts([cachedSelected]);
      setLoading(false);
      return () => { cancelled = true; controller.abort(); };
    }
    if (!accountParam && cachedAccounts) {
      setAccounts(cachedAccounts);
      setLoading(false);
    } else {
      setLoading(true);
    }
    const request = accountParam
      ? loadAccount(accountParam, network, controller.signal).then((item) => [item])
      : loadAccountsForSigner(address, network, controller.signal);
    void request
      .then((items) => { if (!cancelled) setAccounts(items); })
      .catch((cause) => {
        if (!cancelled && !controller.signal.aborted) {
          setAccounts([]);
          setError(cause instanceof Error ? cause.message : 'Unable to load Treasury.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [address, network, accountParam, route.network, routeNetworkMismatch]);

  useEffect(() => {
    if (!privateReady || !address || !network || accounts.length === 0) {
      setTreasuryNames({});
      setTreasuryMetadataReady(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const candidates = accounts.filter((account) => classifyTreasuryRelationship(account, address) !== 'personal_account');
    const candidateIds = candidates.map((account) => account.accountId);
    setTreasuryNames(cachedTreasuryNames(sessionStorage, network, candidateIds));
    setTreasuryMetadataReady(candidates.length === 0);
    void loadSharedTreasuryNames(candidateIds, network, address, controller.signal)
      .then((names) => {
        if (cancelled) return;
        setTreasuryNames((current) => ({ ...current, ...names }));
        setTreasuryMetadataReady(true);
      })
      .catch((cause) => {
        if (!cancelled && !controller.signal.aborted) {
          setTreasuryMetadataReady(false);
          setError(cause instanceof Error ? cause.message : 'Unable to load shared Treasury names.');
        }
      });
    return () => { cancelled = true; controller.abort(); };
  }, [privateReady, address, network, accounts]);

  function dismissTreasuryOnboarding() {
    if (!address || !network) return;
    setTreasuryOnboardingDismissed(true);
    try {
      saveTreasuryOnboardingDismissed(localStorage, address, network);
    } catch {
      setError('This browser could not save the Treasury setup preference.');
    }
  }

  function adoptTreasury(accountId: string) {
    if (!address || !network || adoptedIds.includes(accountId)) return;
    const next = [...adoptedIds, accountId];
    setAdoptedIds(next);
    try {
      saveAdoptedTreasuryAccountIds(localStorage, address, network, next);
    } catch {
      setError('This browser could not save the Treasury choice.');
    }
  }

  const adopted = useMemo(() => new Set(adoptedIds), [adoptedIds]);
  const confirmedAccounts = useMemo(() => address
    ? accounts.filter((account) => adopted.has(account.accountId) && classifyTreasuryRelationship(account, address) !== 'personal_account')
    : [], [accounts, adopted, address]);
  const unadopted = useMemo(() => address
    ? accounts.filter((account) => !adopted.has(account.accountId) || classifyTreasuryRelationship(account, address) === 'personal_account')
    : accounts, [accounts, adopted, address]);
  const suggestedAccounts = useMemo(() => address ? unadopted.filter((account) => classifyTreasuryRelationship(account, address) === 'suggested_treasury') : [], [unadopted, address]);
  const personalAccount = useMemo(() => address ? unadopted.find((account) => classifyTreasuryRelationship(account, address) === 'personal_account') ?? null : null, [unadopted, address]);
  const otherAccounts = useMemo(() => address ? unadopted.filter((account) => classifyTreasuryRelationship(account, address) === 'other_controlled') : [], [unadopted, address]);
  const selectedRelationship = selected && address ? classifyTreasuryRelationship(selected, address) : 'other_controlled';
  const selectedCanAuthorize = Boolean(selected && address && selected.signers.some((signer) => signer.type === 'ed25519_public_key' && signer.key === address && signer.weight > 0));

  return (
    <StellarWorkspaceShell active="treasury" networkContext={network}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">
          {!accountParam && <PageHeader icon={<Vault className="h-6 w-6" />} title="Treasury" description="Treasuries you manage with shared control. MultiSig Tools can discover Stellar accounts this wallet can help authorize; you decide which ones belong in your Treasury list." />}

          {!address && <section className="mx-auto max-w-xl py-14 sm:py-20"><Vault className="h-8 w-8 text-neutral-400" /><h2 className="mt-5 text-3xl font-bold">Connect a wallet</h2><p className="mt-2 text-base leading-7 text-neutral-600 dark:text-neutral-300">We'll use public Stellar account data to find accounts this wallet can help authorize.</p><button type="button" disabled={busy} onClick={() => void connect()} className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white disabled:opacity-50"><WalletCards className="h-4 w-4" />{busy ? 'Opening wallets…' : 'Connect wallet'}</button></section>}

          {address && !privateReady && !accountParam && <section className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03] sm:p-5"><div><div className="font-semibold">Treasury names are private</div><p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Public account relationships are available now. Confirm this wallet only when you want to load shared Treasury names and other private details.</p></div><button type="button" disabled={authBusy} onClick={() => void unlock()} className="flex shrink-0 items-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-2.5 text-sm font-semibold text-emerald-700 disabled:opacity-50 dark:text-emerald-300">{authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Show private details</button></section>}

          {error && <div className="mt-5 flex gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
          {address && loading && accounts.length === 0 && <div className="flex items-center gap-2 py-10 text-sm text-neutral-500 dark:text-neutral-400"><LoaderCircle className="h-4 w-4 animate-spin" />Loading Treasury accounts…</div>}
          {address && !loading && !accountParam && accounts.length === 0 && !error && <section className="py-12 text-sm text-neutral-500 dark:text-neutral-400">No shared-control Stellar accounts were found for this wallet.</section>}

          {accountParam && !loading && address && (!selected || !selectedCanAuthorize) && !error && <section className="py-12"><a href={treasuryOverviewHref()} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />Treasury</a><div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.055] p-4 text-sm">This wallet does not currently have signing authority for that Treasury.</div></section>}

          {selected && selectedCanAuthorize && network && address && <TreasuryDetail
            account={selected}
            network={network}
            adopted={adopted.has(selected.accountId) && selectedRelationship !== 'personal_account'}
            name={treasuryNames[selected.accountId]}
            nameReady={privateReady && treasuryMetadataReady}
            relationship={selectedRelationship}
            onAdopt={() => adoptTreasury(selected.accountId)}
          />}

          {!accountParam && accounts.length > 0 && (
            <div className="mt-6 space-y-8">
              {confirmedAccounts.length > 0 && <section><div className="mb-3 text-sm font-semibold text-neutral-500 dark:text-neutral-400">Treasuries</div><div className="grid gap-4">{confirmedAccounts.map((account) => <TreasuryCard key={account.accountId} account={account} network={network!} name={treasuryNames[account.accountId]} nameReady={privateReady && treasuryMetadataReady} />)}</div></section>}
              {suggestedAccounts.length > 0 && <section><div className="mb-1 text-lg font-bold">Accounts you can manage</div><p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">These accounts already use shared signing on Stellar. Choose the ones you want to manage as Treasuries.</p><div className="grid gap-4">{suggestedAccounts.map((account) => <TreasuryCard key={account.accountId} account={account} network={network!} name={treasuryNames[account.accountId]} nameReady={privateReady && treasuryMetadataReady} suggested onAdopt={() => adoptTreasury(account.accountId)} />)}</div></section>}
              {personalAccount && network && (
                <section>{treasuryOnboardingDismissed
                  ? <CompactCreateTreasury account={personalAccount} network={network} />
                  : <PersonalAccountPrompt account={personalAccount} network={network} onDismiss={dismissTreasuryOnboarding} />}</section>
              )}
              {otherAccounts.length > 0 && <section><div className="mb-3 text-sm font-semibold text-neutral-500 dark:text-neutral-400">Other accounts you can authorize</div><div className="grid gap-4">{otherAccounts.map((account) => <OtherControlledAccount key={account.accountId} account={account} onAdopt={() => adoptTreasury(account.accountId)} />)}</div></section>}
            </div>
          )}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
