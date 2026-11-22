import { useEffect, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { ArrowLeft, ArrowRight, Fingerprint, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { ActionButton, NetworkBadge } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { useUserIdentity } from './UserIdentityContext';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
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

export default function IdentityApp() {
  const { identity, credentials, loading, refresh, network } = useUserIdentity();
  const { privateUnlocked, unlockedAddress, unlockedNetwork, authBusy, unlock } = useStellarWallet();
  const inviteToken = new URLSearchParams(window.location.search).get('token') ?? '';
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const walletVerified = Boolean(privateUnlocked && unlockedAddress && unlockedNetwork === network);
  const walletHeaders = walletVerified ? privateSessionAddressHeaders(unlockedAddress) : {};
  const canPasskey = typeof PublicKeyCredential !== 'undefined';

  useEffect(() => {
    if (!inviteToken) return;
    const controller = new AbortController();
    void fetch(`/api/identity?invite=${encodeURIComponent(inviteToken)}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { invitation?: Invitation; error?: string };
        if (!response.ok || !body.invitation) throw new Error(body.error || 'Invitation is no longer available.');
        if (!controller.signal.aborted) { setInvitation(body.invitation); setInviteError(''); }
      })
      .catch((cause) => { if (!controller.signal.aborted) setInviteError(cause instanceof Error ? cause.message : 'Invitation is unavailable.'); });
    return () => controller.abort();
  }, [inviteToken]);

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
    if (busy) return;
    setBusy(true); setError(''); setInfo('');
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Authentication failed.'); }
    finally { setBusy(false); }
  }

  async function signInWithPasskey() {
    if (!canPasskey) throw new Error('This browser does not support Passkey authentication.');
    const options = await api('authentication_options');
    if (!options.challengeId || !options.options) throw new Error('Missing Passkey challenge.');
    const response = await startAuthentication({ optionsJSON: options.options as PublicKeyCredentialRequestOptionsJSON });
    await api('authentication_verify', { challengeId: options.challengeId, response });
    await refresh();
    setInfo('Signed in with Passkey.');
  }

  async function registerPasskey() {
    if (!canPasskey) throw new Error('This browser does not support Passkeys.');
    const options = await api('registration_options', inviteToken ? { token: inviteToken } : {}, identity?.method === 'stellar_wallet');
    if (!options.challengeId || !options.options) throw new Error('Missing Passkey registration challenge.');
    const response = await startRegistration({ optionsJSON: options.options as PublicKeyCredentialCreationOptionsJSON });
    await api('registration_verify', { challengeId: options.challengeId, response }, identity?.method === 'stellar_wallet');
    await refresh();
    if (inviteToken) navigateWorkspace('/new');
    else setInfo('Passkey added. You can use it next time you sign in.');
  }

  async function acceptInvitation() {
    await api('invitation_accept', { token: inviteToken }, identity?.method === 'stellar_wallet');
    await refresh();
    navigateWorkspace('/new');
  }

  async function confirmWallet() {
    await unlock(undefined, network);
    await refresh();
    setInfo('Wallet verified. You can now accept your invitation or add a Passkey.');
  }

  async function linkWallet() {
    if (!walletVerified) throw new Error('First confirm the wallet you want to link.');
    await api('link_wallet', {}, true);
    await refresh();
    setInfo('Wallet linked to this MST user. Both login methods now open the same account.');
  }

  async function signOut() {
    const response = await fetch('/api/identity', { method: 'DELETE' });
    if (!response.ok) throw new Error('Unable to sign out.');
    await refresh();
    setInfo('Passkey session ended.');
  }

  const inviteOpen = Boolean(inviteToken && invitation && !inviteError);
  return <StellarWorkspaceShell active="new">
    <main className="mst-workbench-page">
      <div className="mx-auto max-w-2xl">
        <a href={stellarHref('/new')} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-ink-2)]"><ArrowLeft className="h-4 w-4" />New proposal</a>
        <div className="mt-5 flex items-center gap-3"><h1 className="text-3xl font-bold">{inviteToken ? 'Join a payment workflow' : 'Your MST account'}</h1><NetworkBadge network={network} /></div>
        <p className="mt-2 text-sm leading-6 text-[var(--color-ink-2)]">A Passkey or Stellar wallet can identify you. Only actual Treasury signers can approve transactions on-chain.</p>
        {inviteOpen && <section className="mt-6 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-2)] p-5">
          <h2 className="font-semibold">You are invited to prepare payments</h2>
          <p className="mt-2 text-sm">Template: <strong>{invitation.templateName}</strong></p>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">A current Treasury signer authorized this invitation. You can prepare a payment, but cannot sign or submit it.</p>
        </section>}
        {inviteError && <p role="alert" className="mt-5 text-sm text-[var(--color-danger)]">{inviteError}</p>}
        {loading && <p role="status" className="mt-4 text-sm"><LoaderCircle className="inline h-4 w-4 animate-spin" /> Checking your account…</p>}
        {error && <p role="alert" className="mt-5 rounded-lg border border-[var(--color-danger)] p-4 text-sm text-[var(--color-danger)]">{error}</p>}
        {info && <p role="status" className="mt-5 text-sm text-[var(--color-ink-2)]">{info}</p>}

        {identity && <section className="mt-6 rounded-xl border border-[var(--color-rule)] p-5">
          <h2 className="font-semibold">Signed in</h2>
          <p className="mt-2 text-sm">{identity.method === 'passkey' ? 'Passkey' : 'Stellar wallet'}</p>
          <p className="mt-1 break-all font-mono text-xs text-[var(--color-muted)]">MST User ID: {identity.userId}</p>
          <ul className="mt-3 space-y-1 text-sm text-[var(--color-ink-2)]">
            {credentials.map((method, index) => <li key={`${method.kind}-${method.address ?? method.id ?? index}`}>
              {method.kind === 'passkey' ? 'Passkey' : `Wallet ${method.address?.slice(0, 8)}…${method.address?.slice(-7)}`}
            </li>)}
          </ul>
          {inviteOpen && <ActionButton className="mt-4" disabled={busy} onClick={() => void perform(acceptInvitation)}>
            <ArrowRight className="h-4 w-4" />Accept invitation
          </ActionButton>}
        </section>}

        <section className="mt-5 space-y-4 rounded-xl border border-[var(--color-rule)] p-5">
          <h2 className="font-semibold">{identity ? 'Manage login methods' : 'Choose how to sign in'}</h2>
          {canPasskey && <div className="flex flex-wrap gap-3">
            <ActionButton disabled={busy} onClick={() => void perform(identity ? registerPasskey : inviteOpen ? registerPasskey : signInWithPasskey)}>
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
              {identity ? 'Add Passkey' : inviteOpen ? 'Create Passkey' : 'Sign in with Passkey'}
            </ActionButton>
            {inviteOpen && !identity && <ActionButton variant="secondary" disabled={busy} onClick={() => void perform(signInWithPasskey)}>Already have a Passkey</ActionButton>}
          </div>}
          {!canPasskey && <p className="text-sm text-[var(--color-muted)]">Passkeys are not available in this browser.</p>}
          <div className="flex flex-wrap gap-3 border-t border-[var(--color-rule)] pt-4">
            {!walletVerified && <ActionButton variant="secondary" disabled={busy || authBusy} onClick={() => void perform(confirmWallet)}>
              <KeyRound className="h-4 w-4" />Use Stellar wallet
            </ActionButton>}
            {walletVerified && identity?.method === 'passkey' && <ActionButton variant="secondary" disabled={busy} onClick={() => void perform(linkWallet)}>
              <ShieldCheck className="h-4 w-4" />Link verified wallet to this user
            </ActionButton>}
            {identity?.method === 'passkey' && <ActionButton variant="secondary" disabled={busy} onClick={() => void perform(signOut)}>Sign out Passkey</ActionButton>}
          </div>
        </section>
        <p className="mt-5 text-xs leading-5 text-[var(--color-muted)]">Your Passkey private key stays on your device or password manager. MST stores only its public credential for verification.</p>
      </div>
    </main>
  </StellarWorkspaceShell>;
}
