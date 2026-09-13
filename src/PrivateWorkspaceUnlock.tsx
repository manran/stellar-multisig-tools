import { useState } from 'react';
import { CircleAlert, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { useStellarWallet } from './StellarWalletContext';
import { getDefaultUnlockDuration } from './stellar/unlockPreferences';
import { isWalletUserRejected } from './stellar/walletKit';

interface Props {
  title: string;
  description: string;
  buttonLabel: string;
  onUnlocked?: () => void | Promise<void>;
}

export default function PrivateWorkspaceUnlock({ title, description, buttonLabel, onUnlocked }: Props) {
  const { authBusy, unlock } = useStellarWallet();
  const unlockSeconds = getDefaultUnlockDuration(localStorage);
  const [attemptError, setAttemptError] = useState('');

  async function unlockAndContinue() {
    setAttemptError('');
    try {
      await unlock(unlockSeconds);
      await onUnlocked?.();
    } catch (cause) {
      if (isWalletUserRejected(cause)) return;
      setAttemptError(cause instanceof Error ? cause.message : 'Unable to verify this wallet.');
    }
  }

  return (
    <section className="mx-auto max-w-xl py-12 sm:py-20">
      <ShieldCheck className="h-8 w-8 text-emerald-600 dark:text-emerald-300" />
      <h1 className="mt-5 text-4xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 text-lg leading-8 text-neutral-600 dark:text-neutral-300">{description}</p>

      <button
        type="button"
        disabled={authBusy}
        onClick={() => void unlockAndContinue()}
        className="mt-7 flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white disabled:opacity-50"
      >
        {authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        {authBusy ? 'Confirm in wallet…' : buttonLabel}
      </button>

      {attemptError && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">{attemptError}</div>
          <button type="button" onClick={() => setAttemptError('')} className="-mr-1 -mt-1 rounded-lg p-1 text-red-700/70 hover:bg-red-500/10 dark:text-red-300/70" aria-label="Dismiss wallet confirmation error">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  );
}
