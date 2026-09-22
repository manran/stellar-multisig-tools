import { useState } from 'react';
import { CircleAlert, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { useStellarWallet } from './StellarWalletContext';
import type { SigningRequestStatus } from '../../../packages/stellar-core/src/requestTypes';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import { isWalletUserRejected } from './stellar/walletKit';

interface Props {
  status: SigningRequestStatus;
  network: StellarNetwork;
  onUnlocked: () => void | Promise<void>;
}

export default function ActivityRetentionNotice({ status, network, onUnlocked }: Props) {
  const { authBusy, unlock } = useStellarWallet();
  const [collapsed, setCollapsed] = useState(false);
  const [attemptError, setAttemptError] = useState('');
  const urgent = status === 'ready';

  async function confirmAndSave() {
    setAttemptError('');
    try {
      await unlock(undefined, network);
      await onUnlocked();
    } catch (cause) {
      if (!isWalletUserRejected(cause)) {
        setAttemptError(cause instanceof Error ? cause.message : 'Unable to confirm this wallet for Activity.');
      }
    }
  }

  if (collapsed) {
    return (
      <section className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${urgent ? 'border-amber-500/30 bg-amber-500/[0.07]' : 'border-black/10 bg-white/55 dark:border-white/10 dark:bg-white/[0.03]'}`}>
        <div className="min-w-0 text-neutral-600 dark:text-neutral-300">{urgent ? 'Not saved to Activity. Submission ends access through this private share link; a confirmed transaction remains recorded on Stellar.' : 'Not saved to Activity. This private share link stops showing proposal details after submission or expiry.'}</div>
        <button type="button" disabled={authBusy} onClick={() => void confirmAndSave()} className="shrink-0 font-semibold text-emerald-700 disabled:opacity-50 dark:text-emerald-300">{authBusy ? 'Confirming…' : 'Save to Activity'}</button>
      </section>
    );
  }

  return (
    <section className={`relative rounded-2xl border p-5 ${urgent ? 'border-amber-500/30 bg-amber-500/[0.07]' : 'border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03]'}`}>
      <button type="button" onClick={() => setCollapsed(true)} className="absolute right-3 top-3 rounded-lg p-1.5 text-neutral-400 hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Collapse Activity reminder"><X className="h-4 w-4" /></button>
      <div className="flex gap-3 pr-7">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" />
        <div>
          <div className="font-semibold">Keep this transaction in Activity</div>
          <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{urgent ? 'All required signatures are present. After submission, this private share link stops showing proposal details. Confirm a current signer wallet now to keep the final status in Activity. The confirmed transaction remains recorded on Stellar.' : 'After submission or expiry, this private share link stops showing proposal details. Confirm a current signer wallet while it is active to keep following it in Activity.'}</p>
          <button type="button" disabled={authBusy} onClick={() => void confirmAndSave()} className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-2.5 text-sm font-semibold text-emerald-700 disabled:opacity-50 dark:text-emerald-300">{authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{authBusy ? 'Confirm in wallet…' : 'Save to Activity'}</button>
          {attemptError && <div className="mt-3 flex gap-2 text-xs text-red-700 dark:text-red-300"><CircleAlert className="h-4 w-4 shrink-0" />{attemptError}</div>}
        </div>
      </div>
    </section>
  );
}
