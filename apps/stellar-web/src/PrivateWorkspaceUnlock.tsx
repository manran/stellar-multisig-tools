import { useState } from 'react';
import type { ReactNode } from 'react';
import { CircleAlert, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { ActionButton } from './MultiSigUi';
import { useStellarWallet } from './StellarWalletContext';
import { getDefaultUnlockDuration } from './stellar/unlockPreferences';
import { isWalletUserRejected } from './stellar/walletKit';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';

interface Props {
  title: string;
  description: string;
  buttonLabel: string;
  context?: ReactNode;
  network?: StellarNetwork;
  onUnlocked?: () => void | Promise<void>;
}

export default function PrivateWorkspaceUnlock({ title, description, buttonLabel, context, network, onUnlocked }: Props) {
  const { address, busy, authBusy, connect, unlock } = useStellarWallet();
  const unlockSeconds = getDefaultUnlockDuration(localStorage);
  const [attemptError, setAttemptError] = useState('');

  async function unlockAndContinue() {
    setAttemptError('');
    try {
      const verifiedAddress = await unlock(unlockSeconds, network);
      if (!verifiedAddress) return;
      await onUnlocked?.();
    } catch (cause) {
      if (isWalletUserRejected(cause)) return;
      setAttemptError(cause instanceof Error ? cause.message : 'Unable to verify this wallet.');
    }
  }

  async function chooseWallet() {
    setAttemptError('');
    try {
      await connect();
    } catch (cause) {
      if (!isWalletUserRejected(cause)) setAttemptError(cause instanceof Error ? cause.message : 'Unable to choose a wallet.');
    }
  }

  return (
    <section className="mx-auto max-w-xl py-12 sm:py-20">
      <ShieldCheck className="h-8 w-8 text-[var(--color-action)]" />
      <h1 className="mt-5 text-4xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 text-lg leading-8 text-neutral-600 dark:text-neutral-300">{description}</p>
      {context && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--color-muted)]">{context}</div>}
      <p className="mt-4 text-sm leading-6 text-[var(--color-muted)]">Your wallet will ask you to sign a verification request. This opens private details. It does not authorize or submit a transaction.</p>

      {address && <p className="mt-4 break-all font-mono text-xs text-[var(--color-ink-2)]">Selected wallet: {address}</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <ActionButton disabled={busy || authBusy} aria-busy={busy || authBusy} onClick={() => void unlockAndContinue()}>
          {busy || authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {authBusy ? 'Confirm in wallet…' : busy ? 'Opening wallets…' : buttonLabel}
        </ActionButton>
        {address && <ActionButton variant="secondary" disabled={busy || authBusy} onClick={() => void chooseWallet()}>Change wallet</ActionButton>}
      </div>

      {attemptError && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--color-danger)] p-4 text-sm text-[var(--color-danger)]">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">{attemptError}</div>
          <button type="button" onClick={() => setAttemptError('')} className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--color-paper-3)] focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]" aria-label="Dismiss wallet confirmation error">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  );
}
