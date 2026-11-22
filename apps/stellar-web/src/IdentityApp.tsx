import { useEffect, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, Fingerprint, KeyRound, LoaderCircle, Pencil, ShieldCheck, WalletCards } from 'lucide-react';
import AccountAvatar from './AccountAvatar';
import { accountDisplayName } from './accountDisplayName';
import { ActionButton } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { useUserIdentity } from './UserIdentityContext';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
import { toolReturnPath } from './stellar/toolAccessRouting';
import { WORKSPACE_COPY } from './workspaceCopy';
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
  const { identity, profile, credentials, loading, refresh, network } = useUserIdentity();
  const { address, privateUnlocked, unlockedAddress, unlockedNetwork, authBusy, unlock, lock, connect } = useStellarWallet();
  // Invitation capabilities stay in URL fragments, never in HTTP request paths.
  const inviteToken = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  const returnToTool = toolReturnPath(new URLSearchParams(window.location.search).get('next'));
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [confirmLink, setConfirmLink] = useState(false);
  const [blockedWallet, setBlockedWallet] = useState('');
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const displayName = identity ? accountDisplayName(identity.userId, profile?.nickname) : '';
  useEffect(() => { setNicknameDraft(profile?.nickname || displayName); setEditingNickname(false); }, [identity?.userId, profile?.nickname]);
  const walletVerified = Boolean(privateUnlocked && address && address === unlockedAddress && unlockedNetwork === network);
  const walletBlocked = walletVerified && blockedWallet === unlockedAddress;
  const walletHeaders = walletVerified ? privateSessionAddressHeaders(unlockedAddress) : {};
  const canPasskey = typeof PublicKeyCredential !== 'undefined';
  const inviteOpen = Boolean(inviteToken && invitation && !inviteError);
  const walletLinked = Boolean(walletVerified && credentials.some(
    (item) => item.kind === 'stellar_wallet' && item.address === unlockedAddress,
  ));
  const actionBusy = busy || authBusy || loading;
  const hasLinkedWallet = credentials.some((item) => item.kind === 'stellar_wallet');

  useEffect(() => { setConfirmLink(false); setBlockedWallet(''); }, [unlockedAddress, identity?.userId]);

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
    if (!response.ok) throw new Error(body.code === 'wallet_already_linked'
      ? WORKSPACE_COPY.identity.conflict
      : body.error || `Identity request failed (${response.status}).`);
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
    // UserIdentityProvider refreshes on wallet verification; a refresh from
    // this render would race with the new selected-wallet scope.
    if (!identity) navigateWorkspace(returnToTool ?? '/inbox');
    else setInfo(WORKSPACE_COPY.identity.verifiedSuccess);
  }

  async function chooseWallet() {
    setConfirmLink(false);
    const address = await connect();
    if (!address) return;
    await unlock(undefined, network);
    setInfo(WORKSPACE_COPY.identity.verifiedSuccess);
  }

  async function linkWallet() {
    if (!walletVerified) throw new Error('First verify the wallet you want to link.');
    try {
      await api('link_wallet', {}, true);
    } catch (cause) {
      if (cause instanceof Error && cause.message === WORKSPACE_COPY.identity.conflict) {
        setBlockedWallet(unlockedAddress);
        setConfirmLink(false);
        return;
      }
      throw cause;
    }
    setConfirmLink(false);
    await refresh();
    setInfo(WORKSPACE_COPY.identity.linkedSuccess);
  }

  async function saveNickname() {
    const nickname = nicknameDraft.trim();
    if (!nickname || [...nickname].length > 64) throw new Error('Nickname must be 1–64 characters.');
    await api('update_profile', { nickname });
    await refresh();
    setEditingNickname(false);
  }

  async function copyUserId() {
    if (!identity) return;
    await navigator.clipboard.writeText(identity.userId);
    setInfo('User ID copied.');
  }

  async function signOutPasskey() {
    const response = await fetch('/api/identity', { method: 'DELETE' });
    if (!response.ok) throw new Error('Unable to sign out.');
    await refresh();
    setInfo('Passkey session ended.');
  }

  async function lockWallet() {
    await lock();
    setInfo('Wallet session locked.');
  }

  return <StellarWorkspaceShell active="new">
    <main className="mst-workbench-page">
      <div className="mx-auto max-w-2xl">
        <a href={stellarHref('')} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-ink-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"><ArrowLeft className="h-4 w-4" />{WORKSPACE_COPY.identity.back}</a>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold sm:text-3xl">{inviteToken ? WORKSPACE_COPY.identity.inviteTitle : identity ? WORKSPACE_COPY.identity.account : WORKSPACE_COPY.identity.signIn}</h1>
        </div>
        {inviteOpen && <section className="mt-6 border-l-2 border-[var(--color-accent)] bg-[var(--color-paper-2)] px-5 py-4">
          <h2 className="font-semibold">{WORKSPACE_COPY.identity.inviteSubheading}</h2>
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
              {inviteOpen ? WORKSPACE_COPY.identity.createWithPasskey : WORKSPACE_COPY.identity.signInPasskey}
            </ActionButton>}
            {canPasskey && <ActionButton variant="secondary" disabled={actionBusy} onClick={() => void perform(inviteOpen ? signInWithPasskey : registerPasskey)} className="min-h-12 w-full justify-center">
              <Fingerprint className="h-4 w-4" />{inviteOpen ? WORKSPACE_COPY.identity.returningPasskey : WORKSPACE_COPY.identity.createPasskey}
            </ActionButton>}
            <ActionButton variant="secondary" disabled={actionBusy} aria-busy={busy || authBusy} onClick={() => void perform(confirmWallet)} className="min-h-12 w-full justify-center">
              <WalletCards className="h-4 w-4" />{WORKSPACE_COPY.identity.signInWallet}
            </ActionButton>
          </div>
          {!canPasskey && <p className="mt-3 text-sm text-[var(--color-muted)]">Passkeys are unavailable in this browser.</p>}
        </section>}

        {identity && <section className="mt-7 border-t border-[var(--color-rule)] pt-6" aria-label="Your account and login methods">
          <div className="flex flex-wrap items-center gap-4">
            <AccountAvatar value={identity.userId} className="h-14 w-14" label="Your account avatar" />
            <div className="min-w-0 flex-1">
              {editingNickname ? <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="identity-nickname" className="sr-only">Nickname</label>
                <input id="identity-nickname" autoFocus maxLength={64} value={nicknameDraft} onChange={(event) => setNicknameDraft(event.target.value)} className="mst-address-control min-w-0 flex-1" />
                <ActionButton disabled={actionBusy || !nicknameDraft.trim()} onClick={() => void perform(saveNickname)}>Save</ActionButton>
                <button type="button" className="text-sm underline" onClick={() => setEditingNickname(false)}>Cancel</button>
              </div> : <div className="flex items-center gap-2">
                <h2 className="min-w-0 break-words text-xl font-semibold">{displayName}</h2>
                <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--color-ink-2)] hover:bg-[var(--color-paper-2)]" onClick={() => { setNicknameDraft(profile?.nickname || displayName); setEditingNickname(true); }} aria-label="Edit nickname"><Pencil className="h-4 w-4" /></button>
              </div>}
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-2)]">
                <span className="font-mono">ID · {identity.userId.slice(0, 8)}</span>
                <button type="button" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold underline underline-offset-4" onClick={() => void perform(copyUserId)}><Copy className="h-3.5 w-3.5" />Copy ID</button>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm text-[var(--color-ink-2)]"><CheckCircle2 className="h-4 w-4 text-[var(--color-accent)]" />{WORKSPACE_COPY.identity.signedInWith(identity.method)}</p>
            </div>
            {inviteOpen && <ActionButton disabled={actionBusy} onClick={() => void perform(acceptInvitation)}><ArrowRight className="h-4 w-4" />{WORKSPACE_COPY.identity.inviteAccept}</ActionButton>}
          </div>
          <details className="mt-4 text-xs text-[var(--color-ink-2)]">
            <summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]">{WORKSPACE_COPY.identity.accountDetails}</summary>
            <p className="break-all font-mono">MST User ID: {identity.userId}</p>
          </details>

          <div className="mt-5 border-t border-[var(--color-rule)] pt-5">
            <h3 className="font-semibold">{WORKSPACE_COPY.identity.methods}</h3>
            <ul className="mt-4 divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
              {credentials.map((method, index) => <li key={method.id ?? method.address ?? index} className="flex min-h-12 items-center gap-3 py-3 text-sm">
                {method.kind === 'passkey' ? <Fingerprint className="h-4 w-4 shrink-0 text-[var(--color-ink-2)]" /> : <WalletCards className="h-4 w-4 shrink-0 text-[var(--color-ink-2)]" />}
                <span className="min-w-0">{method.kind === 'passkey' ? `Passkey ${index + 1}` : `Stellar wallet · ${shortAddress(method.address ?? '')}`}</span>
              </li>)}
            </ul>
            {canPasskey && (
              <div className="mt-5">
                <ActionButton disabled={actionBusy} onClick={() => void perform(registerPasskey)}>
                  <Fingerprint className="h-4 w-4" />{WORKSPACE_COPY.identity.addPasskey}
                </ActionButton>
              </div>
            )}

            <section className="mt-7 border-t border-[var(--color-rule)] pt-5" aria-label={WORKSPACE_COPY.identity.walletTitle}>
              <h3 className="font-semibold">{WORKSPACE_COPY.identity.walletTitle}</h3>
              {walletVerified ? (
                <div className="mst-account-wallet mt-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <ShieldCheck className="h-4 w-4 text-[var(--color-accent)]" />
                    <span className="font-semibold">{WORKSPACE_COPY.identity.verified}</span>
                    <span className="ml-auto text-xs text-[var(--color-ink-2)]">
                      {walletLinked ? WORKSPACE_COPY.identity.linked : WORKSPACE_COPY.identity.notLinked}
                    </span>
                  </div>
                  <p className="mt-2 break-all font-mono text-xs text-[var(--color-ink-2)]">{unlockedAddress}</p>
                  {identity.method === 'passkey' && walletBlocked && (
                    <p role="alert" className="mt-4 border-l-2 border-[var(--color-danger)] pl-3 text-sm leading-6 text-[var(--color-danger)]">
                      {WORKSPACE_COPY.identity.conflict}
                    </p>
                  )}
                  {identity.method === 'passkey' && !walletLinked && !walletBlocked && (
                    confirmLink ? (
                      <div className="mt-5 border-t border-[var(--color-rule)] pt-4">
                        <h4 className="font-semibold">{WORKSPACE_COPY.identity.confirmTitle}</h4>
                        <p className="mt-2 text-sm leading-6 text-[var(--color-ink-2)]">{WORKSPACE_COPY.identity.confirmDescription}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <ActionButton disabled={actionBusy} onClick={() => void perform(linkWallet)}>
                            {WORKSPACE_COPY.identity.confirm}
                          </ActionButton>
                          <ActionButton variant="secondary" disabled={actionBusy} onClick={() => setConfirmLink(false)}>
                            {WORKSPACE_COPY.identity.cancel}
                          </ActionButton>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4">
                        <ActionButton disabled={actionBusy} onClick={() => setConfirmLink(true)}>
                          <WalletCards className="h-4 w-4" />{WORKSPACE_COPY.identity.link}
                        </ActionButton>
                      </div>
                    )
                  )}
                  {identity.method === 'passkey' && (
                    <button type="button" disabled={actionBusy}
                      className="mt-4 block min-h-11 text-sm font-semibold text-[var(--color-ink-2)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:opacity-50"
                      onClick={() => void perform(chooseWallet)}>{WORKSPACE_COPY.identity.switch}</button>
                  )}
                </div>
              ) : (
                <div className="mt-4">
                  <p className="text-sm text-[var(--color-ink-2)]">
                    {hasLinkedWallet ? WORKSPACE_COPY.identity.linkedWalletInactive : WORKSPACE_COPY.identity.walletReadyToLink}
                  </p>
                  <ActionButton className="mt-4" variant="secondary" disabled={actionBusy}
                    onClick={() => void perform(confirmWallet)}>
                    <KeyRound className="h-4 w-4" />
                    {hasLinkedWallet ? WORKSPACE_COPY.identity.verify : WORKSPACE_COPY.identity.connect}
                  </ActionButton>
                </div>
              )}
            </section>
            <div className="mt-4 flex flex-wrap gap-5 text-sm">
              {identity.method === 'passkey' && <button type="button" disabled={actionBusy} className="min-h-11 font-semibold text-[var(--color-ink-2)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:opacity-50" onClick={() => void perform(signOutPasskey)}>{WORKSPACE_COPY.identity.signOutPasskey}</button>}
              {walletVerified && <button type="button" disabled={actionBusy} className="min-h-11 font-semibold text-[var(--color-ink-2)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:opacity-50" onClick={() => void perform(lockWallet)}>{WORKSPACE_COPY.identity.lockWallet}</button>}
            </div>
          </div>
        </section>}

      </div>
    </main>
  </StellarWorkspaceShell>;
}
