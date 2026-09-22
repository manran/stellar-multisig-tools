import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CircleAlert,
  ClipboardCopy,
  KeyRound,
  LoaderCircle,
  Settings2,
  ShieldCheck,
  Trash2,
  Vault,
} from 'lucide-react';
import PrivateWorkspaceUnlock from './PrivateWorkspaceUnlock';
import { PageHeader } from './MultiSigUi';
import { STELLAR_PUBLIC_DOCS_BASE } from './stellar/apiOrigins';
import { analyzeAccountAuthorization } from './stellar/authorization';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import {
  MAX_ACTIVE_TREASURY_AUDIT_KEYS,
  type BoxAuditEvent,
  type TreasuryAuditKeySummary,
  type TreasuryBoxMetadata,
} from './stellar/boxTypes';
import { loadAccount } from './stellar/horizon';
import { privateSessionAddressHeaders } from './stellar/privateSessionTransport';
import { loadAccountsForSigner } from './stellar/signerAccounts';
import { hasSharedSigningControl } from './stellar/treasuryModel';
import type { StellarAccountSnapshot } from './stellar/types';
import {
  parseTreasuryRoute,
  treasuryOverviewHref,
  treasurySigningHref,
} from './treasuryNavigation';
import { stellarHref } from './workspaceNavigation';
import { cacheTreasuryName, cachedTreasuryName } from './treasuryMetadataCache';

function shortAddress(value: string) {
  return value.length <= 22 ? value : `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function eventTitle(event: BoxAuditEvent) {
  switch (event.action) {
    case 'box_name_changed': return 'Treasury name changed';
    case 'audit_credential_created': return 'Audit credential created';
    case 'audit_credentials_viewed': return 'Audit credential metadata viewed';
    case 'audit_credential_revoked': return 'Audit credential revoked';
  }
}

function actorLabel(event: BoxAuditEvent) {
  if (event.actor.type === 'treasury_audit') return event.actor.label ? `Audit credential · ${event.actor.label}` : `Audit credential · ${event.actor.id}`;
  return shortAddress(event.actor.id);
}

export default function TreasuryBoxSettingsApp() {
  const {
    address,
    network: connectedNetwork,
    networkSource,
    busy,
    connect,
    privateUnlocked,
    unlockedAddress,
    unlockedNetwork,
  } = useStellarWallet();
  const route = useMemo(() => parseTreasuryRoute(window.location.search), []);
  const initialAccountId = route.accountId;
  const network = networkSource === 'application' && route.network ? route.network : connectedNetwork;
  const resourceNetwork = route.network ?? network;
  const routeNetworkMismatch = Boolean(route.network && connectedNetwork && networkSource === 'wallet' && route.network !== connectedNetwork);
  const [accounts, setAccounts] = useState<StellarAccountSnapshot[]>([]);
  const [accountSnapshot, setAccountSnapshot] = useState<StellarAccountSnapshot | null>(null);
  const [accountId, setAccountId] = useState(initialAccountId);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [metadata, setMetadata] = useState<TreasuryBoxMetadata | null>(null);
  const [keys, setKeys] = useState<TreasuryAuditKeySummary[]>([]);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [audit, setAudit] = useState<BoxAuditEvent[]>([]);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [keyLabel, setKeyLabel] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [keysLoading, setKeysLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const privateReady = Boolean(
    privateUnlocked
    && address
    && network
    && unlockedAddress === address
    && unlockedNetwork === network
    && !routeNetworkMismatch,
  );
  const cachedName = accountId && resourceNetwork ? cachedTreasuryName(sessionStorage, resourceNetwork, accountId) : '';
  const activeKeyCount = keys.filter((key) => !key.revokedAt).length;
  const missingCreationAuditKeys = useMemo(() => {
    if (!keysLoaded || !auditLoaded) return [];
    const created = new Set(audit
      .filter((event) => event.action === 'audit_credential_created')
      .map((event) => typeof event.metadata?.keyId === 'string' ? event.metadata.keyId : '')
      .filter(Boolean));
    return keys.filter((key) => !created.has(key.keyId));
  }, [keys, keysLoaded, audit, auditLoaded]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!accountId || !resourceNetwork || routeNetworkMismatch) {
      setAccountSnapshot(null);
      setAccountLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setAccountLoading(true);
    void loadAccount(accountId, resourceNetwork, controller.signal)
      .then((item) => { if (!cancelled) setAccountSnapshot(item); })
      .catch((cause) => {
        if (!cancelled && !controller.signal.aborted) {
          setAccountSnapshot(null);
          setError(cause instanceof Error ? cause.message : 'Unable to load Treasury signing policy.');
        }
      })
      .finally(() => { if (!cancelled) setAccountLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [accountId, resourceNetwork, routeNetworkMismatch]);

  useEffect(() => {
    if (!address || !network || initialAccountId) {
      setAccounts([]);
      setAccountsLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setAccountsLoading(true);
    void loadAccountsForSigner(address, network, controller.signal)
      .then((items) => {
        if (cancelled) return;
        const treasuries = items.filter(hasSharedSigningControl);
        setAccounts(treasuries);
        if (!accountId && treasuries.length === 1) chooseAccount(treasuries[0].accountId);
      })
      .catch(() => { if (!cancelled && !controller.signal.aborted) setAccounts([]); })
      .finally(() => { if (!cancelled) setAccountsLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [address, network, initialAccountId]);

  useEffect(() => {
    setMetadata(null);
    setNameDraft('');
    setKeys([]);
    setKeysLoaded(false);
    setAudit([]);
    setAuditLoaded(false);
    setNewSecret('');
    setCopied(false);
    setError('');
    if (privateReady && accountId) void loadMetadata();
  }, [privateReady, accountId]);

  useEffect(() => {
    setNameDraft(metadata?.name ?? '');
  }, [metadata?.name]);

  function chooseAccount(next: string) {
    setAccountId(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('account', next); else url.searchParams.delete('account');
    if (next && network) url.searchParams.set('network', network); else if (!next) url.searchParams.delete('network');
    window.history.replaceState({}, '', url);
  }

  async function api(include?: 'audit-keys' | 'audit', init?: RequestInit) {
    if (!accountId) throw new Error('Choose a treasury first.');
    const url = new URL('/api/treasury-box', window.location.origin);
    url.searchParams.set('account', accountId);
    if (resourceNetwork) url.searchParams.set('network', resourceNetwork);
    if (include) url.searchParams.set('include', include);
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(privateSessionAddressHeaders(address))) headers.set(name, value);
    const response = await fetch(url, { cache: 'no-store', ...init, headers });
    const body = await response.json() as {
      metadata?: TreasuryBoxMetadata | null;
      keys?: TreasuryAuditKeySummary[];
      audit?: BoxAuditEvent[];
      auditKey?: string;
      key?: TreasuryAuditKeySummary;
      error?: string;
    };
    if (!response.ok) throw new Error(body.error || 'Treasury settings request failed.');
    return body;
  }

  async function loadMetadata() {
    setLoading(true);
    setError('');
    try {
      const body = await api();
      setMetadata(body.metadata ?? null);
      if (resourceNetwork && accountId) cacheTreasuryName(sessionStorage, resourceNetwork, accountId, body.metadata?.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Treasury settings.');
    } finally {
      setLoading(false);
    }
  }

  async function saveTreasuryName() {
    const next = nameDraft.trim();
    if (!next || next === (metadata?.name ?? '')) return;
    setNameSaving(true);
    setError('');
    try {
      const body = await api(undefined, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
      });
      if (!body.metadata?.name) throw new Error('Treasury name was not returned.');
      setMetadata(body.metadata);
      if (resourceNetwork && accountId) cacheTreasuryName(sessionStorage, resourceNetwork, accountId, body.metadata.name);
      if (auditLoaded) await loadAudit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to rename Treasury.');
    } finally {
      setNameSaving(false);
    }
  }

  async function loadKeys() {
    setKeysLoading(true);
    setError('');
    try {
      const body = await api('audit-keys');
      setKeys(body.keys ?? []);
      setKeysLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Audit credentials.');
    } finally {
      setKeysLoading(false);
    }
  }

  async function loadAudit() {
    setAuditLoading(true);
    setError('');
    try {
      const body = await api('audit');
      setAudit(body.audit ?? []);
      setAuditLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load administration history.');
    } finally {
      setAuditLoading(false);
    }
  }

  async function createKey() {
    setKeysLoading(true);
    setError('');
    setNewSecret('');
    setCopied(false);
    try {
      const body = await api(undefined, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: keyLabel }),
      });
      if (!body.auditKey) throw new Error('Audit credential secret was not returned.');
      setNewSecret(body.auditKey);
      setKeyLabel('');
      await loadKeys();
      if (auditLoaded) await loadAudit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create Audit credential.');
    } finally {
      setKeysLoading(false);
    }
  }

  async function revokeKey(keyId: string) {
    setKeysLoading(true);
    setError('');
    try {
      await api(undefined, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId }),
      });
      await loadKeys();
      if (auditLoaded) await loadAudit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to revoke Audit credential.');
    } finally {
      setKeysLoading(false);
    }
  }

  async function copySecret() {
    if (!newSecret) return;
    await navigator.clipboard.writeText(newSecret);
    setCopied(true);
  }

  const title = metadata?.name || cachedName || (privateReady && !loading ? 'Unnamed treasury' : 'Treasury');
  const policy = accountSnapshot ? analyzeAccountAuthorization(accountSnapshot) : null;

  return (
    <StellarWorkspaceShell active="treasury" networkContext={network}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">
          {accountId && (
            <a href={treasuryOverviewHref(accountId, resourceNetwork)} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white">
              <ArrowLeft className="h-4 w-4" />Treasury / {title}
            </a>
          )}

          <div className={accountId ? 'mt-5' : ''}>
            <PageHeader
              icon={<Vault className="h-6 w-6" />}
              title="Treasury settings"
              description="Review the public signing policy, then unlock only when you need private Treasury settings, Audit access, or administration history."
            />
          </div>

          {!address && (
            <section className="mx-auto max-w-xl py-14 sm:py-20">
              <Vault className="h-8 w-8 text-neutral-400" />
              <h2 className="mt-5 text-3xl font-bold">Connect a Treasury signer</h2>
              <p className="mt-2 text-base leading-7 text-neutral-600 dark:text-neutral-300">A current active signer can manage this Treasury.</p>
              <button type="button" disabled={busy} onClick={() => void connect()} className="mst-action-primary mt-6 disabled:opacity-50">{busy ? 'Opening wallets…' : 'Connect wallet'}</button>
            </section>
          )}

          {address && !accountId && (
            <section className="mst-settings-picker mt-5">
              <label className="block max-w-2xl">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Treasury</span>
                <select value={accountId} onChange={(event) => chooseAccount(event.target.value)} disabled={accountsLoading} className="mst-settings-control mt-2 w-full font-semibold">
                  <option value="">Choose a treasury</option>
                  {accounts.map((account) => <option key={account.accountId} value={account.accountId}>{shortAddress(account.accountId)} · {account.thresholds.medium} approval threshold</option>)}
                </select>
              </label>
              {accountsLoading && <div className="mt-3 flex items-center gap-2 text-xs text-neutral-500"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Loading Treasury access…</div>}
              {!accountsLoading && accounts.length === 0 && <p className="mt-3 text-sm text-neutral-500">No shared-control Treasury was found for this wallet on this network.</p>}
            </section>
          )}

          {routeNetworkMismatch && <div className="mt-5 flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />This Treasury link is for {route.network === 'testnet' ? 'Testnet' : 'Mainnet'}, but the connected wallet is on {connectedNetwork === 'testnet' ? 'Testnet' : 'Mainnet'}.</div>}

          {address && accountId && accountLoading && !accountSnapshot && <div className="mt-5 flex items-center gap-2 py-4 text-sm text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading signing policy…</div>}

          {address && accountId && accountSnapshot && policy && (
            <section className="mst-settings-section mt-5">
              <div className="flex items-start gap-3">
                <Settings2 className="mt-0.5 h-5 w-5 text-neutral-400" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold">Signing policy</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">This is public Stellar account state. Unlocking MultiSig Tools is not required to review it.</p>
                  <div className="mst-settings-fact-grid">
                    <div className="mst-settings-fact-cell"><div className="mst-settings-fact-label">Active signers</div><div className="mst-settings-fact-value">{accountSnapshot.signers.filter((signer) => signer.type === 'ed25519_public_key' && signer.weight > 0).length}</div></div>
                    <div className="mst-settings-fact-cell"><div className="mst-settings-fact-label">Payment approvals</div><div className="mst-settings-fact-value">{accountSnapshot.thresholds.medium} / {policy.totalActiveWeight}</div></div>
                    <div className="mst-settings-fact-cell"><div className="mst-settings-fact-label">Account-control approvals</div><div className="mst-settings-fact-value">{accountSnapshot.thresholds.high} / {policy.totalActiveWeight}</div></div>
                  </div>
                  {resourceNetwork && <a href={treasurySigningHref(accountId, resourceNetwork)} className="mst-action-secondary mt-4">Review or change signing policy</a>}
                </div>
              </div>
            </section>
          )}

          {address && accountId && !privateReady && !routeNetworkMismatch && (
            <PrivateWorkspaceUnlock title="Unlock private Treasury settings" description="Confirm this wallet to view private Treasury settings. This does not sign or submit a Stellar transaction." buttonLabel="Unlock private settings" />
          )}

          {error && <div className="mt-5 flex gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

          {privateReady && accountId && (
            <div className="mst-settings-private mt-5">
              {loading && !metadata && <div className="flex items-center gap-2 py-4 text-sm text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading Treasury settings…</div>}

              <section className="mst-settings-section">
                <h2 className="text-xl font-bold">Treasury name</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">Shared with current Treasury signers. Personal Address Book names never become a Treasury name.</p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={80} placeholder="Treasury name" className="mst-settings-control min-w-0 flex-1" />
                  <button type="button" disabled={nameSaving || !nameDraft.trim() || nameDraft.trim() === (metadata?.name ?? '')} onClick={() => void saveTreasuryName()} className="mst-action-primary disabled:opacity-40">{nameSaving ? 'Saving…' : 'Save name'}</button>
                </div>
              </section>

              <details
                onToggle={(event) => { if (event.currentTarget.open && !keysLoaded && !keysLoading) void loadKeys(); }}
                className="mst-settings-disclosure"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3"><KeyRound className="h-5 w-5 shrink-0 text-neutral-400" /><div><div className="font-bold">Audit access</div><div className="mt-1 text-sm font-normal text-neutral-500 dark:text-neutral-400">Create read-only credentials for accounting, monitoring, compliance, or external audit systems.</div></div></div>
                    {keysLoaded && <div className="shrink-0 text-xs font-semibold text-neutral-400">{activeKeyCount} of {MAX_ACTIVE_TREASURY_AUDIT_KEYS} active</div>}
                  </div>
                </summary>
                <div className="mt-5 border-t border-black/10 pt-5 dark:border-white/10">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <p className="max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">A Treasury Audit credential can read this Treasury's Activity only. It cannot access a signer's Inbox or personal contacts, create Requests, contribute signatures, submit transactions, or manage Treasury settings.</p>
                    <a href={`${STELLAR_PUBLIC_DOCS_BASE}/developers/agent-api`} className="shrink-0 text-sm font-semibold text-emerald-700 underline decoration-emerald-700/30 underline-offset-4 dark:text-emerald-300">Agent & Audit API documentation →</a>
                  </div>

                  {newSecret && (
                    <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                      <div className="flex items-start gap-3">
                        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">Copy this Audit credential now</div>
                          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">The complete secret is shown only once. Store it in the auditor or monitoring service secret manager, then hide it here.</p>
                          <div className="mt-3 break-all rounded-lg bg-black/5 p-3 font-mono text-xs dark:bg-white/10">{newSecret}</div>
                          <div className="mt-3 flex flex-wrap items-center gap-4">
                            <button type="button" onClick={() => void copySecret()} className="inline-flex items-center gap-2 text-sm font-semibold"><ClipboardCopy className="h-4 w-4" />{copied ? 'Copied' : 'Copy credential'}</button>
                            <button type="button" onClick={() => { setNewSecret(''); setCopied(false); }} className="text-sm font-semibold text-neutral-600 underline decoration-black/20 underline-offset-4 dark:text-neutral-300 dark:decoration-white/20">Done</button>
                            <a href={`${STELLAR_PUBLIC_DOCS_BASE}/developers/agent-api#treasury-audit-credentials`} className="text-sm font-semibold text-neutral-600 underline decoration-black/20 underline-offset-4 dark:text-neutral-300 dark:decoration-white/20">View Audit API guidance</a>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-5">
                    <label className="block text-sm font-semibold" htmlFor="api-key-label">Audit credential label</label>
                    <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Name the accounting, monitoring, compliance, or audit system that uses this read-only credential.</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input id="api-key-label" value={keyLabel} onChange={(event) => setKeyLabel(event.target.value)} maxLength={80} placeholder="External auditor" className="mst-settings-control min-w-0 flex-1" />
                      <button type="button" disabled={keysLoading || !keysLoaded || !keyLabel.trim() || activeKeyCount >= MAX_ACTIVE_TREASURY_AUDIT_KEYS} onClick={() => void createKey()} className="mst-action-primary disabled:opacity-40">Create Audit credential</button>
                    </div>
                    {keysLoaded && <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{activeKeyCount} of {MAX_ACTIVE_TREASURY_AUDIT_KEYS} active Audit credentials. Revoke an unused credential before creating another when the limit is reached.</p>}
                  </div>

                  {keysLoading && <div className="mt-4 flex items-center gap-2 text-sm text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading Audit access…</div>}
                  {!keysLoading && keysLoaded && keys.length === 0 && <p className="mt-5 text-sm text-neutral-500">No Audit credentials yet.</p>}
                  {!keysLoading && keys.length > 0 && (
                    <div className="mt-5 divide-y divide-black/10 dark:divide-white/10">
                      {keys.map((key) => (
                        <div key={key.keyId} className="flex flex-wrap items-center justify-between gap-3 py-4">
                          <div>
                            <div className="text-sm font-semibold">{key.label}</div>
                            <div className="mt-1 font-mono text-xs text-neutral-400">{key.prefix}…</div>
                            <div className="mt-1 text-xs text-neutral-500">Created {new Date(key.createdAt).toLocaleString()} by {shortAddress(key.createdBy)} · {key.lastUsedAt ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}` : 'Never used'}{key.revokedAt ? ` · Revoked ${new Date(key.revokedAt).toLocaleString()}${key.revokedBy ? ` by ${shortAddress(key.revokedBy)}` : ''}` : ''}</div>
                          </div>
                          {!key.revokedAt && <button type="button" disabled={keysLoading} onClick={() => void revokeKey(key.keyId)} className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-300"><Trash2 className="h-4 w-4" />Revoke</button>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>

              <details
                onToggle={(event) => { if (event.currentTarget.open && !auditLoaded && !auditLoading) void loadAudit(); }}
                className="mst-settings-disclosure"
              >
                <summary className="cursor-pointer list-none">
                  <div className="font-bold">Administration history</div>
                  <div className="mt-1 text-sm font-normal text-neutral-500 dark:text-neutral-400">Who changed Treasury settings and created, viewed, or revoked Treasury Audit credentials.</div>
                </summary>
                <div className="mt-5 border-t border-black/10 pt-5 dark:border-white/10">
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">This history is append-only at the application layer. Private Note plaintext and credential secrets are never included.</p>
                  {auditLoading && <div className="mt-4 flex items-center gap-2 text-sm text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading administration history…</div>}
                  {!auditLoading && auditLoaded && audit.length === 0 && missingCreationAuditKeys.length === 0 && <p className="mt-5 text-sm text-neutral-500">No administration history yet.</p>}
                  {!auditLoading && auditLoaded && missingCreationAuditKeys.length > 0 && (
                    <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
                      <div className="font-semibold">Some existing API keys do not have a creation event in the current audit store.</div>
                      <p className="mt-1 leading-6">Their durable credential metadata is still shown under Audit access. MultiSig Tools does not invent historical audit events to fill the gap.</p>
                      <div className="mt-3 space-y-1 text-xs">{missingCreationAuditKeys.map((key) => <div key={key.keyId}>{key.label} · created {new Date(key.createdAt).toLocaleString()} by {shortAddress(key.createdBy)}</div>)}</div>
                    </div>
                  )}
                  {!auditLoading && audit.length > 0 && <div className="mt-5 divide-y divide-black/10 dark:divide-white/10">{[...audit].reverse().map((event) => <div key={event.eventId} className="py-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><div className="text-sm font-semibold">{eventTitle(event)}</div><time className="text-xs text-neutral-400">{new Date(event.occurredAt).toLocaleString()}</time></div><div className="mt-1 text-xs text-neutral-500">{actorLabel(event)}</div>{event.detail && <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{event.detail}</div>}<div className="mt-1 font-mono text-[10px] text-neutral-400">integrity {event.integrityHash.slice(0, 16)}…</div></div>)}</div>}
                </div>
              </details>
            </div>
          )}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
