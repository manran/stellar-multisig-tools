import { useEffect, useState } from 'react';
import { CircleAlert, ClipboardCopy, KeyRound, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';
import PrivateWorkspaceUnlock from './PrivateWorkspaceUnlock';
import { PageHeader } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import {
  MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS,
  type AgentAccessLevel,
  type SignerAgentCredentialSummary,
  type SignerPrincipalRef,
} from './stellar/agentAccessTypes';
import { privateSessionAddressHeaders } from './stellar/privateSessionTransport';

const ACCESS_OPTIONS: readonly { value: AgentAccessLevel; title: string; detail: string }[] = [
  {
    value: 'read',
    title: 'Read',
    detail: 'Read your Inbox, Activity, Requests, saved contracts, personal contacts, and accessible Treasury metadata.',
  },
  {
    value: 'write',
    title: 'Write',
    detail: 'Includes Read. Create Signing Requests, keep or forget contracts, update personal contacts, and perform non-cryptographic collaboration actions such as decline.',
  },
  {
    value: 'sign',
    title: 'Sign',
    detail: 'Includes Write. Submit signed XDR and contribute a valid Stellar signature attributable to this signer.',
  },
];

function shortAddress(value: string) {
  return value.length <= 22 ? value : `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export default function AgentAccessApp() {
  const {
    address,
    network,
    busy,
    connect,
    privateUnlocked,
    unlockedAddress,
    unlockedNetwork,
  } = useStellarWallet();
  const [credentials, setCredentials] = useState<SignerAgentCredentialSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState('');
  const [access, setAccess] = useState<AgentAccessLevel>('read');
  const [newSecret, setNewSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const privateReady = Boolean(
    privateUnlocked
    && address
    && network
    && unlockedAddress === address
    && unlockedNetwork === network,
  );
  const activeCount = credentials.filter((item) => !item.revokedAt).length;

  useEffect(() => {
    setCredentials([]);
    setLoaded(false);
    setNewSecret('');
    setCopied(false);
    setError('');
    if (privateReady) void loadCredentials();
  }, [privateReady, address, network]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function api(init?: RequestInit) {
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(privateSessionAddressHeaders(address))) headers.set(name, value);
    const response = await fetch('/api/agent-access', { cache: 'no-store', ...init, headers });
    const body = await response.json() as {
      principal?: SignerPrincipalRef;
      credentials?: SignerAgentCredentialSummary[];
      credential?: SignerAgentCredentialSummary;
      apiKey?: string;
      error?: string;
    };
    if (!response.ok) throw new Error(body.error || 'Agent access request failed.');
    return body;
  }

  async function loadCredentials() {
    setLoading(true);
    setError('');
    try {
      const body = await api();
      setCredentials(body.credentials ?? []);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Agent access.');
    } finally {
      setLoading(false);
    }
  }

  async function createCredential() {
    setLoading(true);
    setError('');
    setNewSecret('');
    try {
      const body = await api({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, access }),
      });
      if (!body.apiKey) throw new Error('Agent credential secret was not returned.');
      setNewSecret(body.apiKey);
      setLabel('');
      await loadCredentials();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create Agent credential.');
    } finally {
      setLoading(false);
    }
  }

  async function revokeCredential(credentialId: string) {
    setLoading(true);
    setError('');
    try {
      await api({
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId }),
      });
      await loadCredentials();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to revoke Agent credential.');
    } finally {
      setLoading(false);
    }
  }

  async function copySecret() {
    if (!newSecret) return;
    await navigator.clipboard.writeText(newSecret);
    setCopied(true);
  }

  return (
    <StellarWorkspaceShell active="inbox" networkContext={network}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-4xl">
          <PageHeader
            icon={<KeyRound className="h-6 w-6" />}
            title="Agent access"
            description="Create credentials for agents that act on behalf of this Stellar signer. The signer is the Principal; each credential identifies a separate Agent actor."
          />

          {!address && (
            <section className="mx-auto max-w-xl py-14 sm:py-20">
              <KeyRound className="h-8 w-8 text-neutral-400" />
              <h2 className="mt-5 text-3xl font-bold">Connect the signer</h2>
              <p className="mt-2 text-base leading-7 text-neutral-600 dark:text-neutral-300">Agent credentials belong to a signer identity, not to a Treasury.</p>
              <button type="button" disabled={busy} onClick={() => void connect()} className="mst-action-primary mt-6 disabled:opacity-50">{busy ? 'Opening wallets…' : 'Connect wallet'}</button>
            </section>
          )}

          {address && !privateReady && (
            <PrivateWorkspaceUnlock title="Unlock Agent access" description="Confirm this wallet before creating or revoking credentials that represent this signer. This does not sign a Stellar transaction." buttonLabel="Unlock Agent access" />
          )}

          {error && <div className="mt-5 flex gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

          {privateReady && address && network && (
            <div className="mst-agent-stack mt-5">
              <section className="mst-agent-principal">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Principal</div>
                <div className="mt-2 font-mono text-sm">{address}</div>
                <div className="mt-1 text-xs text-neutral-500">{network === 'testnet' && <><span className="text-sky-700 dark:text-sky-300">Testnet</span><span> · </span></>}{activeCount} of {MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS} active credentials</div>
              </section>

              <section className="mst-agent-section">
                <h2 className="text-xl font-bold">Create Agent credential</h2>
                <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Access levels are cumulative: Write includes Read; Sign includes Write. Use a separate credential for each agent so Activity can retain the actual actor.</p>

                <div className="mst-agent-access-grid mt-5">
                  {ACCESS_OPTIONS.map((option) => (
                    <button key={option.value} type="button" onClick={() => setAccess(option.value)} aria-pressed={access === option.value} className={`mst-agent-access-option ${access === option.value ? 'mst-agent-access-option--selected' : ''}`}>
                      <div className="font-bold">{option.title}</div>
                      <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{option.detail}</p>
                    </button>
                  ))}
                </div>

                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder="My ChatGPT" className="mst-agent-control min-w-0 flex-1" />
                  <button type="button" disabled={loading || !label.trim() || activeCount >= MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS} onClick={() => void createCredential()} className="mst-action-primary disabled:opacity-40">Create credential</button>
                </div>

                {access === 'sign' && (
                  <div className="mt-4 flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    <div><strong>Sign is an API permission, not key custody.</strong> MultiSig Tools never turns this credential into a Stellar private key. Submitted signatures are independently verified against the Principal signer.</div>
                  </div>
                )}

                {newSecret && (
                  <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <div className="font-semibold">Copy this credential now</div>
                    <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">The complete secret is shown only once. Store it in the Agent or service secret manager.</p>
                    <div className="mt-3 break-all rounded-lg bg-black/5 p-3 font-mono text-xs dark:bg-white/10">{newSecret}</div>
                    <div className="mt-3 flex gap-4"><button type="button" onClick={() => void copySecret()} className="inline-flex items-center gap-2 text-sm font-semibold"><ClipboardCopy className="h-4 w-4" />{copied ? 'Copied' : 'Copy credential'}</button><button type="button" onClick={() => setNewSecret('')} className="text-sm font-semibold underline decoration-black/20 underline-offset-4 dark:decoration-white/20">Done</button></div>
                  </div>
                )}
              </section>

              <section className="mst-agent-section">
                <h2 className="text-xl font-bold">Agent credentials</h2>
                {loading && !loaded && <div className="mt-4 flex items-center gap-2 text-sm text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading Agent access…</div>}
                {!loading && loaded && credentials.length === 0 && <p className="mt-4 text-sm text-neutral-500">No Agent credentials yet.</p>}
                {credentials.length > 0 && <div className="mt-4 divide-y divide-black/10 dark:divide-white/10">{credentials.map((credential) => (
                  <div key={credential.credentialId} className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div>
                      <div className="flex items-center gap-2"><span className="text-sm font-semibold">{credential.label}</span><span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-bold uppercase dark:bg-white/10">{credential.access}</span></div>
                      <div className="mt-1 font-mono text-xs text-neutral-400">{credential.prefix}…</div>
                      <div className="mt-1 text-xs text-neutral-500">Principal {shortAddress(credential.principal.address)} · Created {new Date(credential.createdAt).toLocaleString()} · {credential.lastUsedAt ? `Last used ${new Date(credential.lastUsedAt).toLocaleString()}` : 'Never used'}{credential.revokedAt ? ` · Revoked ${new Date(credential.revokedAt).toLocaleString()}` : ''}</div>
                    </div>
                    {!credential.revokedAt && <button type="button" disabled={loading} onClick={() => void revokeCredential(credential.credentialId)} className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-300"><Trash2 className="h-4 w-4" />Revoke</button>}
                  </div>
                ))}</div>}
              </section>
            </div>
          )}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
