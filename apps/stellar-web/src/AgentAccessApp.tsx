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
} from '../../../packages/stellar-core/src/agentAccessTypes';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
import { isWalletUserRejected } from './stellar/walletKit';

const ACCESS_OPTIONS: readonly { value: AgentAccessLevel; title: string; detail: string }[] = [
  {
    value: 'read',
    title: 'Read',
    detail: 'View Inbox, proposals, Activity, contacts, contracts, and accessible Treasury information.',
  },
  {
    value: 'write',
    title: 'Write',
    detail: 'Everything in Read, plus prepare proposals, manage contacts and contracts, and respond to collaboration requests. No Stellar signing authority.',
  },
  {
    value: 'sign',
    title: 'Sign',
    detail: 'Everything in Write, plus submit signed XDR or contribute verified signer signatures. Does not grant access to a private key.',
  },
];

interface AgentPairingPreview {
  requestId: string;
  userCode: string;
  label: string;
  access: AgentAccessLevel;
  network: 'testnet';
  expiresAt: string;
  status: 'pending' | 'approved' | 'denied';
}

interface AgentPairingCreated extends AgentPairingPreview {
  deviceCode: string;
  verificationUri: string;
}

function shortAddress(value: string) {
  return value.length <= 22 ? value : `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export default function AgentAccessApp() {
  const {
    address,
    network,
    busy,
    connect,
    approveAgentGrant,
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
  const [pendingRevokeId, setPendingRevokeId] = useState('');
  const [showRevoked, setShowRevoked] = useState(false);
  const incomingGrantId = new URLSearchParams(window.location.search).get('grant');
  const [incomingGrant, setIncomingGrant] = useState<AgentPairingPreview | null>(null);
  const [grantError, setGrantError] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);
  const privateReady = Boolean(
    privateUnlocked
    && address
    && network
    && unlockedAddress === address
    && unlockedNetwork === network,
  );
  const activeCredentials = credentials.filter((item) => !item.revokedAt);
  const revokedCredentials = credentials.filter((item) => Boolean(item.revokedAt));
  const visibleCredentials = showRevoked ? [...activeCredentials, ...revokedCredentials] : activeCredentials;
  const activeCount = activeCredentials.length;

  useEffect(() => {
    setCredentials([]);
    setLoaded(false);
    setNewSecret('');
    setCopied(false);
    setError('');
    setPendingRevokeId('');
    setShowRevoked(false);
    if (privateReady) void loadCredentials();
  }, [privateReady, address, network]);

  useEffect(() => {
    if (!incomingGrantId) return;
    let cancelled = false;
    fetch('/api/agent-grants?id=' + encodeURIComponent(incomingGrantId), { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Unable to load this Agent request.');
        return body as AgentPairingPreview;
      })
      .then((grant) => { if (!cancelled) setIncomingGrant(grant); })
      .catch((cause) => { if (!cancelled) setGrantError(cause instanceof Error ? cause.message : 'Unable to load Agent request.'); });
    return () => { cancelled = true; };
  }, [incomingGrantId]);

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

  async function grantApi(body: Record<string, unknown>) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    for (const [name, value] of Object.entries(privateSessionAddressHeaders(address))) headers.set(name, value);
    const response = await fetch('/api/agent-grants', {
      method: 'POST', cache: 'no-store', headers, body: JSON.stringify(body),
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String(result.error || 'Agent pairing failed.'));
    return result;
  }

  async function approvePairing(requestId: string) {
    if (!address || network !== 'testnet' || !privateReady) {
      throw new Error('Connect and confirm a Testnet signer wallet first.');
    }
    const response = await fetch('/api/agent-grants?id=' + encodeURIComponent(requestId) + '&challenge=1', {
      cache: 'no-store', headers: privateSessionAddressHeaders(address),
    });
    const challenge = await response.json() as { message?: string; transaction?: string; signer?: string; error?: string };
    if (!response.ok || !challenge.message || !challenge.transaction || challenge.signer !== address) {
      throw new Error(challenge.error || 'Unable to prepare this wallet approval.');
    }
    const approval = await approveAgentGrant(challenge.message, challenge.transaction, network);
    await grantApi({ action: 'approve', requestId, ...approval });
  }

  async function createCredential() {
    setLoading(true);
    setError('');
    setNewSecret('');
    try {
      if (network !== 'testnet' || !privateReady) throw new Error('Connect and confirm a Testnet signer wallet.');
      // Manual mode uses the same single-use pairing and fresh signature as an external Agent.
      const created = await grantApi({ action: 'request', label, access, network }) as unknown as AgentPairingCreated;
      await approvePairing(created.requestId);
      const exchanged = await grantApi({ action: 'poll', deviceCode: created.deviceCode });
      if (exchanged.status !== 'approved' || typeof exchanged.apiKey !== 'string') {
        throw new Error('The approved pairing did not return a credential.');
      }
      setNewSecret(exchanged.apiKey);
      setLabel('');
      await loadCredentials();
    } catch (cause) {
      if (!isWalletUserRejected(cause)) setError(cause instanceof Error ? cause.message : 'Unable to create Agent credential.');
    } finally {
      setLoading(false);
    }
  }

  async function connectSigner() {
    setGrantError('');
    try {
      const selected = await connect();
      if (!selected) setGrantError('Wallet connection cancelled. Choose a wallet to continue this request.');
    } catch (cause) {
      setGrantError(cause instanceof Error ? cause.message : 'Wallet connection failed. Try again or choose another wallet.');
    }
  }

  async function respondToIncomingGrant(action: 'approve' | 'deny') {
    if (!incomingGrant) return;
    setGrantBusy(true);
    setGrantError('');
    try {
      if (network !== 'testnet' || !privateReady) throw new Error('Confirm a Testnet wallet first.');
      if (action === 'approve') await approvePairing(incomingGrant.requestId);
      else await grantApi({ action: 'deny', requestId: incomingGrant.requestId });
      setIncomingGrant({ ...incomingGrant, status: action === 'approve' ? 'approved' : 'denied' });
      if (action === 'approve') await loadCredentials();
    } catch (cause) {
      setGrantError(isWalletUserRejected(cause)
        ? 'Wallet approval cancelled. You can retry this request before it expires.'
        : cause instanceof Error ? cause.message : 'Unable to respond to Agent request.');
    } finally {
      setGrantBusy(false);
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
      setPendingRevokeId('');
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
    <StellarWorkspaceShell active="agent-access" networkContext={network}>
      <main className="mst-workbench-page">
        <div className="mx-auto max-w-6xl">
          <PageHeader
            title="Agent access"
            description="Approve each agent with your wallet. Review, revoke, or connect agent credentials here."
          />

          {incomingGrantId && (
            <section aria-label="Agent authorization request" className="mst-agent-section mt-6">
              <h2 className="text-xl font-bold">An agent is requesting access</h2>
              {grantError && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{grantError}</p>}
              {incomingGrant && (
                <>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div><div className="text-xs font-semibold text-[var(--color-muted)]">Agent</div><div className="mt-1 text-lg font-semibold break-words">{incomingGrant.label}</div></div>
                    <div><div className="text-xs font-semibold text-[var(--color-muted)]">Permission</div><div className="mt-1 text-lg font-semibold capitalize">{incomingGrant.access}</div></div>
                    <div><div className="text-xs font-semibold text-[var(--color-muted)]">Network</div><div className="mt-1 font-semibold">Stellar Testnet</div></div>
                    <div><div className="text-xs font-semibold text-[var(--color-muted)]">Verification code</div><div className="mt-1 font-mono text-lg font-semibold tracking-wide">{incomingGrant.userCode}</div></div>
                  </div>
                  <p className="mt-4 text-sm text-[var(--color-ink-2)]">Compare this code and permission with the agent's request. Approval creates a reusable credential for this signer. The agent receives the credential directly; no key is shown here.</p>
                  {incomingGrant.status === 'pending' && privateReady && (
                    <div className="mt-5 flex flex-wrap gap-3">
                      <button type="button" disabled={grantBusy} onClick={() => void respondToIncomingGrant('approve')} className="mst-action-primary disabled:opacity-40">{grantBusy ? 'Waiting for wallet…' : 'Approve in wallet'}</button>
                      <button type="button" disabled={grantBusy} onClick={() => void respondToIncomingGrant('deny')} className="mst-action-secondary disabled:opacity-40">Deny</button>
                    </div>
                  )}
                  {incomingGrant.status === 'pending' && <p role="status" className="mt-4 text-sm font-semibold">{!address ? 'Connect your Testnet wallet below.' : !privateReady ? 'Wallet selected. Confirm your identity below.' : grantBusy ? 'Waiting for your wallet approval…' : 'Wallet confirmed. Review and approve this request.'}</p>}
                  {incomingGrant.status === 'pending' && <p className="mt-2 text-sm text-[var(--color-muted)]">Using a CLI or another signing tool? <a className="underline" href="https://docs.multisig.tools/stellar/developers/agent-quickstart#approve-with-an-independent-signing-tool" target="_blank" rel="noreferrer">Approve without a browser wallet</a>.</p>}
                  {incomingGrant.status === 'approved' && <p role="status" className="mt-4 text-sm font-semibold text-[var(--color-success)]">Approved. The agent may now complete pairing.</p>}
                  {incomingGrant.status === 'denied' && <p role="status" className="mt-4 text-sm font-semibold">Access denied.</p>}
                </>
              )}
            </section>
          )}

          {!address && (
            <section className="mx-auto max-w-xl py-14 sm:py-20">
              <KeyRound className="h-8 w-8 text-neutral-400" />
              <h2 className="mt-5 text-3xl font-bold">Connect the signer</h2>
              <p className="mt-2 text-base leading-7 text-neutral-600 dark:text-neutral-300">Agent credentials belong to a signer identity, not to a Treasury.</p>
              {!incomingGrantId && grantError && <p role="alert" className="mt-4 text-sm text-[var(--color-danger)]">{grantError}</p>}
              <button type="button" disabled={busy} onClick={() => void connectSigner()} className="mst-action-primary mt-6 disabled:opacity-50">{busy ? 'Opening wallets…' : 'Connect wallet'}</button>
            </section>
          )}

          {address && !privateReady && (
            <PrivateWorkspaceUnlock title="Unlock Agent access" description="Confirm this wallet before creating or revoking credentials that represent this signer. This does not sign a Stellar transaction." buttonLabel="Unlock Agent access" />
          )}

          {error && <div className="mt-5 flex gap-3 rounded-xl border border-[var(--color-danger)] p-4 text-sm text-[var(--color-danger)]"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

          {privateReady && address && network && (
            <div className="mst-agent-stack mt-5">
              <section className="mst-agent-principal">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Principal</div>
                <div className="mt-2 break-all font-mono text-sm">{address}</div>
                <div className="mt-1 text-xs text-neutral-500">{network === 'testnet' && <><span className="text-[var(--color-info)]">Testnet</span><span> · </span></>}{activeCount} of {MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS} active credentials</div>
              </section>

                {newSecret && (
                  <section className="mst-agent-secret" role="status">
                    <div className="font-semibold">Copy this credential now</div>
                    <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">The complete secret is shown only once. Store it in the Agent or service secret manager.</p>
                    <div className="mt-3 break-all rounded-lg bg-black/5 p-3 font-mono text-xs dark:bg-white/10">{newSecret}</div>
                    <div className="mt-3 flex gap-4"><button type="button" onClick={() => void copySecret()} className="inline-flex items-center gap-2 text-sm font-semibold"><ClipboardCopy className="h-4 w-4" />{copied ? 'Copied' : 'Copy credential'}</button><button type="button" onClick={() => setNewSecret('')} className="text-sm font-semibold underline decoration-black/20 underline-offset-4 dark:decoration-white/20">Done</button></div>
                  </section>
                )}

              <section className="mst-agent-section">
                <div className="mst-operations-section-head mst-agent-credential-head">
                  <div><h2>Current agents <span className="mst-operations-count">{activeCount}</span></h2><p>Review each agent's scope and recent use. Revoke access you no longer need.</p></div>
                  {revokedCredentials.length > 0 && <button type="button" className="mst-action-secondary" aria-pressed={showRevoked} onClick={() => setShowRevoked((value) => !value)}>{showRevoked ? 'Hide revoked' : 'Show revoked (' + revokedCredentials.length + ')'}</button>}
                </div>
                {loading && !loaded && <div className="mt-4 flex items-center gap-2 text-sm text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading Agent access…</div>}
                {!loading && loaded && activeCount === 0 && <p className="mt-4 text-sm text-neutral-500">No active agents. Create a credential below to connect one.</p>}
                {visibleCredentials.length > 0 && <div className="mst-agent-credential-list">{visibleCredentials.map((credential) => (
                  <div key={credential.credentialId} className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div>
                      <div className="flex items-center gap-2"><span className="text-sm font-semibold">{credential.label}</span><span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-bold uppercase dark:bg-white/10">{credential.access}</span></div>
                      <div className="mt-1 font-mono text-xs text-neutral-400">{credential.prefix}…</div>
                      <div className="mt-1 text-xs text-neutral-500">Principal {shortAddress(credential.principal.address)} · Created {new Date(credential.createdAt).toLocaleString()} · {credential.lastUsedAt ? `Last used ${new Date(credential.lastUsedAt).toLocaleString()}` : 'Never used'}{credential.revokedAt ? ` · Revoked ${new Date(credential.revokedAt).toLocaleString()}` : ''}</div>
                    </div>
                    {!credential.revokedAt && (pendingRevokeId === credential.credentialId ? (
                      <div className="mst-agent-revoke-confirm" role="group" aria-label={'Revoke ' + credential.label}>
                        <span>Revoke {credential.label}?</span>
                        <button type="button" disabled={loading} onClick={() => void revokeCredential(credential.credentialId)} className="mst-agent-danger-action">Confirm revoke</button>
                        <button type="button" disabled={loading} onClick={() => setPendingRevokeId('')} className="mst-action-secondary">Cancel</button>
                      </div>
                    ) : (
                      <button type="button" disabled={loading} onClick={() => setPendingRevokeId(credential.credentialId)} className="mst-agent-danger-action"><Trash2 className="h-4 w-4" />Revoke</button>
                    ))}
                  </div>
                ))}</div>}
              </section>

              {!incomingGrantId && <section className="mst-agent-section">
                <h2 className="text-xl font-bold">{activeCount > 0 ? 'Create another manual credential' : 'Create a manual credential'}</h2>
                <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">For a remote agent, ask it to start a pairing request and open the link it gives you. For manual credentials, choose the minimum permission and approve once more in your wallet. Write includes Read; Sign includes Write.</p>

                <div className="mst-agent-access-grid mt-5">
                  {ACCESS_OPTIONS.map((option) => (
                    <button key={option.value} type="button" onClick={() => setAccess(option.value)} aria-pressed={access === option.value} className={`mst-agent-access-option ${access === option.value ? 'mst-agent-access-option--selected' : ''}`}>
                      <div className="font-bold">{option.title}</div>
                      <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{option.detail}</p>
                    </button>
                  ))}
                </div>

                <div className="mst-agent-create-form">
                  <label htmlFor="agent-name">Agent name</label>
                  <div className="mst-agent-create-form__actions">
                    <input id="agent-name" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder="e.g. My ChatGPT" className="mst-agent-control min-w-0 flex-1" />
                    <button type="button" disabled={loading || network !== 'testnet' || !label.trim() || activeCount >= MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS} onClick={() => void createCredential()} className="mst-action-primary disabled:opacity-40">{loading ? 'Waiting for wallet…' : 'Approve and create'}</button>
                  </div>
                </div>

                {access === 'sign' && (
                  <div className="mt-4 flex gap-3 rounded-xl border border-[var(--color-warning)] bg-[var(--color-paper-2)] p-4 text-sm text-[var(--color-ink)]">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    <div><strong>Sign is an API permission, not key custody.</strong> MultiSig Tools never turns this credential into a Stellar private key. Submitted signatures are independently verified against the Principal signer.</div>
                  </div>
                )}

              </section>}
            </div>
          )}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
