import { useEffect, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { ArrowLeft, ArrowRight, CheckCircle2, Fingerprint, KeyRound, LoaderCircle, ShieldCheck, WalletCards } from 'lucide-react';
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

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export default function IdentityApp() {
  const { identity, credentials, loading, refresh, network } = useUserIdentity();
  const { privateUnlocked, unlockedAddress, unlockedNetwork, authBusy, unlock, lock, connect } = useStellarWallet();
  // Invitation capabilities stay in URL fragments, never in HTTP request paths.
  const inviteToken = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
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
  const passkeyCount = credentials.filter((item) => item.kind === 'passkey').length;
  const walletCount = credentials.filter((item) => item.kind === 'stellar_wallet').length;
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
    if (!inviteToken) navigateWorkspace('/inbox');
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
    else if (!identity) navigateWorkspace('/');
    else setInfo('Passkey added to your MST account.');
  }

  async function acceptInvitation() {
    await api('invitation_accept', { token: inviteToken }, identity?.method === 'stellar_wallet');
    await refresh();
    navigateWorkspace('/new');
  }

  async function confirmWallet() {
    await unlock(undefined, network);
    await refresh();
    if (!identity) navigateWorkspace('/inbox');
    else setInfo('Wallet verified. Chain signing still follows the Treasury rules.');
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
    setInfo('Wallet linked. Both login methods now open the same MST account.');
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
        <a href={stellarHref('/new')} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-ink-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"><ArrowLeft className="h-4 w-4" />New proposal</a>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">{inviteToken ? 'Join a payment workflow' : 'Your MST account'}</h1>
          <NetworkBadge network={network} />
        </div>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--color-ink-2)]">
          Use a Passkey or Stellar wallet to access the same account. When signing, MST checks the authorization rules for that exact transaction.
        </p>

        {inviteOpen && <section className="mt-6 border-l-2 border-[var(--color-accent)] bg-[var(--color-paper-2)] px-5 py-4">
          <h2 className="font-semibold">Invitation to prepare payments</h2>
          <p className="mt-1 text-sm">{invitation.templateName}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-2)]">You can prepare payments under this Template. A Treasury signer must still authorize each Classic transaction.</p>
        </section>}
        {inviteError && <p role="alert" className="mt-5 text-sm text-[var(--color-danger)]">{inviteError}</p>}
        {loading && <p role="status" className="mt-4 text-sm text-[var(--color-ink-2)]"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />Checking your account…</p>}
        {error && <p role="alert" className="mt-5 rounded-lg border border-[var(--color-danger)] p-4 text-sm text-[var(--color-danger)]">{error}</p>}
        {info && <p role="status" className="mt-5 text-sm text-[var(--color-ink-2)]">{info}</p>}

        {!identity && <section className="mt-7 border-t border-[var(--color-rule)] pt-6" aria-label="Choose how to sign in">
          <h2 className="text-xl font-semibold">Continue to MST</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">No wallet or email is needed to start with a Passkey.</p>
          <div className="mt-5 flex flex-col gap-3">
            {canPasskey && <ActionButton disabled={actionBusy} aria-busy={busy} onClick={() => void perform(inviteOpen ? registerPasskey : signInWithPasskey)} className="min-h-12 w-full justify-center">
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
              {inviteOpen ? 'Create account with Passkey' : 'Sign in with Passkey'}
            </ActionButton>}
            {canPasskey && <ActionButton variant="secondary" disabled={actionBusy} onClick={() => void perform(inviteOpen ? signInWithPasskey : registerPasskey)} className="min-h-12 w-full justify-center">
              <Fingerprint className="h-4 w-4" />{inviteOpen ? 'Already have a Passkey' : 'Create a new Passkey account'}
            </ActionButton>}
            <ActionButton variant="secondary" disabled={actionBusy} aria-busy={busy || authBusy} onClick={() => void perform(confirmWallet)} className="min-h-12 w-full justify-center">
              <WalletCards className="h-4 w-4" />Continue with Stellar wallet
            </ActionButton>
          </div>
          {!canPasskey && <p className="mt-3 text-sm text-[var(--color-muted)]">Passkeys are not available in this browser. You can still use a Stellar wallet.</p>}
        </section>}

        {identity && <section className="mt-7 border-t border-[var(--color-rule)] pt-6" aria-label="Your account and login methods">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Account</h2>
              <p className="mt-1 flex items-center gap-2 text-sm text-[var(--color-ink-2)]"><CheckCircle2 className="h-4 w-4 text-[var(--color-accent)]" />Signed in with {identity.method === 'passkey' ? 'Passkey' : 'Stellar wallet'}</p>
            </div>
            {inviteOpen && <ActionButton disabled={actionBusy} onClick={() => void perform(acceptInvitation)}><ArrowRight className="h-4 w-4" />Accept invitation</ActionButton>}
          </div>
          <details className="mt-4 text-xs text-[var(--color-ink-2)]">
            <summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]">Account details</summary>
            <p className="break-all font-mono">MST User ID: {identity.userId}</p>
          </details>

          <div className="mt-5 border-t border-[var(--color-rule)] pt-5">
            <h3 className="font-semibold">Login methods</h3>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">{passkeyCount} Passkey{passkeyCount === 1 ? '' : 's'} · {walletCount} wallet{walletCount === 1 ? '' : 's'} linked</p>
            <ul className="mt-4 divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
              {credentials.map((method, index) => <li key={method.id ?? method.address ?? index} className="flex min-h-12 items-center gap-3 py-3 text-sm">
                {method.kind === 'passkey' ? <Fingerprint className="h-4 w-4 shrink-0 text-[var(--color-ink-2)]" /> : <WalletCards className="h-4 w-4 shrink-0 text-[var(--color-ink-2)]" />}
                <span className="min-w-0">{method.kind === 'passkey' ? `Passkey ${index + 1}` : `Stellar wallet · ${shortAddress(method.address ?? '')}`}</span>
                <span className="ml-auto shrink-0 text-xs text-[var(--color-ink-2)]">Linked</span>
              </li>)}
            </ul>
            <div className="mt-5 flex flex-wrap gap-3">
              {canPasskey && <ActionButton disabled={actionBusy} onClick={() => void perform(registerPasskey)}><Fingerprint className="h-4 w-4" />Add Passkey</ActionButton>}
              {!walletVerified && <ActionButton variant="secondary" disabled={actionBusy} onClick={() => void perform(confirmWallet)}><KeyRound className="h-4 w-4" />Verify a wallet</ActionButton>}
              {identity.method === 'passkey' && walletVerified && !walletLinked && <ActionButton variant="secondary" disabled={actionBusy} onClick={() => void perform(linkWallet)}><ShieldCheck className="h-4 w-4" />Link verified wallet</ActionButton>}
              {identity.method === 'passkey' && <ActionButton variant="secondary" disabled={actionBusy} onClick={() => void perform(chooseWallet)}><WalletCards className="h-4 w-4" />Choose wallet</ActionButton>}
            </div>
            {identity.method === 'passkey' && walletVerified && !walletLinked && <p className="mt-3 text-sm leading-6 text-[var(--color-ink-2)]">This wallet is not linked to the current MST account. Linking requires confirmation of both methods. A wallet owned by another MST account cannot be merged automatically.</p>}
            <div className="mt-4 flex flex-wrap gap-5 text-sm">
              {identity.method === 'passkey' && <button type="button" disabled={actionBusy} className="min-h-11 font-semibold text-[var(--color-ink-2)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:opacity-50" onClick={() => void perform(signOutPasskey)}>Sign out Passkey</button>}
              {walletVerified && <button type="button" disabled={actionBusy} className="min-h-11 font-semibold text-[var(--color-ink-2)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:opacity-50" onClick={() => void perform(lockWallet)}>Lock wallet session</button>}
            </div>
          </div>
        </section>}

        <section className="mt-8 border-t border-[var(--color-rule)] pt-6" aria-label="Signing authority">
          <h2 className="text-xl font-semibold">Signing authority</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-2)]">Login methods are not signing permissions. Every Proposal shows only methods authorized for that transaction.</p>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex gap-3"><WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-2)]" /><p><strong>Classic:</strong> sign with an authorized Stellar wallet.</p></div>
            <div className="flex gap-3"><Fingerprint className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-2)]" /><p><strong>Soroban:</strong> a Passkey can sign only after it is registered as a signer on a supported smart account. MST login alone does not authorize a contract.</p></div>
          </div>
          <p className="mt-5 text-xs leading-5 text-[var(--color-muted)]">Private keys stay with your wallet or Passkey provider. MST stores verified credentials for login; it does not hold your signing keys.</p>
        </section>
      </div>
    </main>
  </StellarWorkspaceShell>;
}
