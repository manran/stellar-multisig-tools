import { useEffect, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { ArrowLeft, ArrowRight, CheckCircle2, Fingerprint, KeyRound, LoaderCircle, ShieldCheck, WalletCards } from 'lucide-react';
import { ActionButton } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { useUserIdentity } from './UserIdentityContext';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
import { toolReturnPath } from './stellar/toolAccessRouting';
import { navigateWorkspace, stellarHref } from './workspaceNavigation';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

interface ResponseBody {
  error?: string;
  code?: string;
  options?: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON;
  challengeId?: string;
  authenticated?: boolean;
  accepted?: boolean;
  linked?: boolean;
}

interface Invitation {
  templateName: string;
  templateId: string;
  network: 'testnet' | 'public';
}

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export default function IdentityApp() {
  const { identity, credentials, loading, refresh, network } = useUserIdentity();
  const { privateUnlocked, unlockedAddress, unlockedNetwork, authBusy, unlock, lock, connect } = useStellarWallet();
  // Invitation capabilities stay in URL fragments, never in HTTP request paths.
  const inviteToken = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  const returnToTool = toolReturnPath(new URLSearchParams(window.location.search).get('next'));
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const walletVerified = Boolean(privateUnlocked && unlockedAddress && unlockedNetwork === network);
  const walletHeaders = walletVerified ? privateSessionAddressHeaders(unlockedAddress) : {};
  const canPasskey = typeof PublicKeyCredential !== 'undefined';
  const inviteOpen = Boolean(inviteToken && invitation && !inviteError);
  const walletLinked = Boolean(walletVerified && credentials.some(
    (item) => item.kind === 'stellar_wallet' && item.address === unlockedAddress,
  ));
  const actionBusy = busy || authBusy || loading;

  useEffect(() => {
    if (!inviteToken) return;
    const controller = new AbortController();
    void fetch('/api/identity', {
      method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invitation_preview', network, token: inviteToken }),
    })
      .then(async (response) => {
        const body = await response.json() as { invitation?: Invitation; error?: string };
        if (!response.ok || !body.invitation) throw new Error(body.error || 'Invitation is no longer available.');
        if (!controller.signal.aborted) { setInvitation(body.invitation); setInviteError(''); }
      })
      .catch((cause) => { if (!controller.signal.aborted) setInviteError(cause instanceof Error ? cause.message : 'Invitation is unavailable.'); });
    return () => controller.abort();
  }, [inviteToken, network]);

  async function api(action: string, data: Record<string, unknown> = {}, wallet = false): Promise<ResponseBody> {
    const response = await fetch('/api/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(wallet ? walletHeaders : {}) },
      body: JSON.stringify({ network, action, ...data }),
    });
    const body = await response.json() as ResponseBody;
    if (!response.ok) throw new Error(body.error || `Identity request failed (${response.status}).`);
    return body;
  }

  async function perform(task: () => Promise<void>) {
    if (actionBusy) return;
    setBusy(true);
    setError('');
    setInfo('');
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Authentication failed.'); }
    finally { setBusy(false); }
  }

  async function signInWithPasskey() {
    if (!canPasskey) throw new Error('Passkeys are not supported in this browser.');
    const options = await api('authentication_options');
    if (!options.challengeId || !options.options) throw new Error('Missing Passkey challenge.');
    const response = await startAuthentication({ optionsJSON: options.options as PublicKeyCredentialRequestOptionsJSON });
    await api('authentication_verify', { challengeId: options.challengeId, response });
    await refresh();
    if (!inviteToken) navigateWorkspace(returnToTool ?? '/inbox');
    else setInfo('Signed in with Passkey. You can accept this invitation.');
  }

  async function registerPasskey() {
    if (!canPasskey) throw new Error('Passkeys are not supported in this browser.');
    const options = await api('registration_options', inviteToken ? { token: inviteToken } : {}, identity?.method === 'stellar_wallet');
    if (!options.challengeId || !options.options) throw new Error('Missing Passkey registration challenge.');
    const response = await startRegistration({ optionsJSON: options.options as PublicKeyCredentialCreationOptionsJSON });
    await api('registration_verify', { challengeId: options.challengeId, response }, identity?.method === 'stellar_wallet');
    await refresh();
    if (inviteToken) navigateWorkspace('/new');
    else if (!identity) navigateWorkspace(returnToTool ?? '/');
    else setInfo('Passkey added.');
  }

  async function acceptInvitation() {
    await api('invitation_accept', { token: inviteToken }, identity?.method === 'stellar_wallet');
    await refresh();
    navigateWorkspace('/new');
  }

  async function confirmWallet() {
    await unlock(undefined, network);
    await refresh();
    if (!identity) navigateWorkspace(returnToTool ?? '/inbox');
    else setInfo('Wallet verified.');
  }

  async function chooseWallet() {
    const address = await connect();
    if (!address) return;
    await unlock(undefined, network);
    await refresh();
    setInfo('Wallet verified. You can link it to your MST account.');
  }

  async function linkWallet() {
    if (!walletVerified) throw new Error('First verify the wallet you want to link.');
    await api('link_wallet', {}, true);
    await refresh();
    setInfo('Wallet linked.');
  }

  async function signOutPasskey() {
    const response = await fetch('/api/identity', { method: 'DELETE' });
    if (!response.ok) throw new Error('Unable to sign out.');
    await refresh();
    setInfo('Passkey session ended.');
  }

  async function lockWallet() {
    await lock();
    await refresh();
    setInfo('Wallet session locked.');
  }

  return <StellarWorkspaceShell active="new">
    <main className="mst-workbench-page">
      <div className="mx-auto max-w-2xl">
        <a href={stellarHref('')} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-ink-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"><ArrowLeft className="h-4 w-4" />Back to home</a>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold sm:text-3xl">{inviteToken ? 'Join payment workflow' : identity ? 'Your account' : 'Sign in or sign up'}</h1>
        </div>
        {inviteOpen && <section className="mt-6 border-l-2 border-[var(--color-accent)] bg-[var(--color-paper-2)] px-5 py-4">
          <h2 className="font-semibold">Payment invitation</h2>
          <p className="mt-1 text-sm">{invitation.templateName}</p>
        </section>}
        {inviteError && <p role="alert" className="mt-5 text-sm text-[var(--color-danger)]">{inviteError}</p>}
        {loading && <p role="status" className="mt-4 text-sm text-[var(--color-ink-2)]"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />Checking your account…</p>}
        {error && <p role="alert" className="mt-5 rounded-lg border border-[var(--color-danger)] p-4 text-sm text-[var(--color-danger)]">{error}</p>}
        {info && <p role="status" className="mt-5 text-sm text-[var(--color-ink-2)]">{info}</p>}

        {!identity && <section className="mt-7 border-t border-[var(--color-rule)] pt-6" aria-label="Choose how to sign in">
          <div className="mt-5 flex flex-col gap-3">
            {canPasskey && <ActionButton disabled={actionBusy} aria-busy={busy} onClick={() => void perform(inviteOpen ? registerPasskey : signInWithPasskey)} className="min-h-12 w-full justify-center">
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
              {inviteOpen ? 'Create account with Passkey' : 'Sign in with Passkey'}
            </ActionButton>}
            {canPasskey && <ActionButton variant="secondary" disabled={actionBusy} onClick={() => void perform(inviteOpen ? signInWithPasskey : registerPasskey)} className="min-h-12 w-full justify-center">
              <Fingerprint className="h-4 w-4" />{inviteOpen ? 'Already have a Passkey' : 'Create Passkey account'}
            </ActionButton>}
            <ActionButton variant="secondary" disabled={actionBusy} aria-busy={busy || authBusy} onClick={() => void perform(confirmWallet)} className="min-h-12 w-full justify-center">
              <WalletCards className="h-4 w-4" />Sign in with Stellar wallet
            </ActionButton>
          </div>
          {!canPasskey && <p className="mt-3 text-sm text-[var(--color-muted)]">Passkeys are unavailable in this browser.</p>}
        </section>}

        {identity && <section className="mt-7 border-t border-[var(--color-rule)] pt-6" aria-label="Your account and login methods">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm text-[var(--color-ink-2)]"><CheckCircle2 className="h-4 w-4 text-[var(--color-accent)]" />Signed in with {identity.method === 'passkey' ? 'Passkey' : 'Stellar wallet'}</p>
            </div>
            {inviteOpen && <ActionButton disabled={actionBusy} onClick={() => void perform(acceptInvitation)}><ArrowRight className="h-4 w-4" />Accept invitation</ActionButton>}
          </div>
          <details className="mt-4 text-xs text-[var(--color-ink-2)]">
            <summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]">Account details</summary>
            <p className="break-all font-mono">MST User ID: {identity.userId}</p>
          </details>

          <div className="mt-5 border-t border-[var(--color-rule)] pt-5">
            <h3 className="font-semibold">Login methods</h3>
            <ul className="mt-4 divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
              {credentials.map((method, index) => <li key={method.id ?? method.address ?? index} className="flex min-h-12 items-center gap-3 py-3 text-sm">
                {method.kind === 'passkey' ? <Fingerprint className="h-4 w-4 shrink-0 text-[var(--color-ink-2)]" /> : <WalletCards className="h-4 w-4 shrink-0 text-[var(--color-ink-2)]" />}
                <span className="min-w-0">{method.kind === 'passkey' ? `Passkey ${index + 1}` : `Stellar wallet · ${shortAddress(method.address ?? '')}`}</span>
              </li>)}
            </ul>
            <div className="mt-5 flex flex-wrap gap-3">
              {canPasskey && <ActionButton disabled={actionBusy} onClick={() => void perform(registerPasskey)}><Fingerprint className="h-4 w-4" />Add Passkey</ActionButton>}
              {!walletVerified && <ActionButton variant="secondary" disabled={actionBusy} onClick={() => void perform(confirmWallet)}><KeyRound className="h-4 w-4" />Add Stellar wallet</ActionButton>}
              {identity.method === 'passkey' && walletVerified && !walletLinked && <ActionButton variant="secondary" disabled={actionBusy} onClick={() => void perform(linkWallet)}><ShieldCheck className="h-4 w-4" />Link wallet</ActionButton>}
              {identity.method === 'passkey' && <ActionButton variant="secondary" disabled={actionBusy} onClick={() => void perform(chooseWallet)}><WalletCards className="h-4 w-4" />Switch wallet</ActionButton>}
            </div>
            <div className="mt-4 flex flex-wrap gap-5 text-sm">
              {identity.method === 'passkey' && <button type="button" disabled={actionBusy} className="min-h-11 font-semibold text-[var(--color-ink-2)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:opacity-50" onClick={() => void perform(signOutPasskey)}>Sign out Passkey</button>}
              {walletVerified && <button type="button" disabled={actionBusy} className="min-h-11 font-semibold text-[var(--color-ink-2)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:opacity-50" onClick={() => void perform(lockWallet)}>Lock wallet session</button>}
            </div>
          </div>
        </section>}

      </div>
    </main>
  </StellarWorkspaceShell>;
}
