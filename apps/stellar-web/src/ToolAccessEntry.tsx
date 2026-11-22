import { useState } from 'react';
import { Fingerprint, LoaderCircle, WalletCards } from 'lucide-react';
import { useUserIdentity } from './UserIdentityContext';
import { useStellarWallet } from './StellarWalletContext';
import { isWalletUserRejected } from './stellar/walletKit';
import type { ToolPath } from './stellar/toolAccessRouting';
import { stellarHrefWithSearch } from './workspaceNavigation';

export default function ToolAccessEntry({ returnTo }: { returnTo: ToolPath }) {
  const { identity, loading } = useUserIdentity();
  const { unlock, busy, authBusy } = useStellarWallet();
  const [error, setError] = useState('');

  async function openWallet() {
    setError('');
    try {
      await unlock();
    } catch (cause) {
      if (!isWalletUserRejected(cause)) setError(cause instanceof Error ? cause.message : 'Unable to verify wallet.');
    }
  }

  return (
    <section aria-label="Tool access" className="mx-auto max-w-xl py-12 sm:py-20">
      {loading ? (
        <div role="status" className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <LoaderCircle className="h-4 w-4 animate-spin" />Checking account…
        </div>
      ) : identity ? (
        <>
          <WalletCards className="h-8 w-8 text-[var(--color-action)]" />
          <h2 className="mt-5 text-3xl font-bold">Connect Stellar wallet</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-2)]">This tool uses a verified Stellar wallet.</p>
          <button type="button" disabled={busy || authBusy} aria-busy={busy || authBusy} onClick={() => void openWallet()} className="mst-action-primary mt-6 disabled:opacity-50">
            {busy || authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <WalletCards className="h-4 w-4" />}
            {authBusy ? 'Verifying wallet…' : busy ? 'Opening wallets…' : 'Connect Stellar wallet'}
          </button>
        </>
      ) : (
        <>
          <Fingerprint className="h-8 w-8 text-[var(--color-action)]" />
          <h2 className="mt-5 text-3xl font-bold">Sign in to continue</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-ink-2)]">This tool needs a Stellar wallet.</p>
          <a href={stellarHrefWithSearch('/identity', { next: returnTo })} className="mst-action-primary mt-6">Sign in / Sign up</a>
        </>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-[var(--color-danger)]">{error}</p>}
    </section>
  );
}
