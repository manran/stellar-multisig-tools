import { useState } from 'react';
import { Inbox, LoaderCircle, WalletCards } from 'lucide-react';
import InboxApp from './InboxApp';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { connectAndVerifyPrivateInbox } from './stellar/inboxEntry';
import { isWalletUserRejected } from './stellar/walletKit';

export default function InboxEntryApp() {
  const wallet = useStellarWallet();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');

  async function openInbox() {
    setOpening(true);
    setOpenError('');
    try {
      await connectAndVerifyPrivateInbox(wallet.connect, () => wallet.unlock());
    } catch (cause) {
      if (!isWalletUserRejected(cause)) {
        setOpenError(cause instanceof Error ? cause.message : 'Unable to verify this wallet.');
      }
      // If wallet selection succeeded but identity proof failed, InboxApp falls
      // back to the explicit Unlock recovery surface instead of hiding the state.
    } finally {
      setOpening(false);
    }
  }

  if (wallet.address) return <InboxApp />;

  return (
    <StellarWorkspaceShell active="inbox">
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <section className="mx-auto max-w-xl py-12 sm:py-20">
          <Inbox className="h-8 w-8 text-emerald-600 dark:text-emerald-300" />
          <h1 className="mt-5 text-4xl font-bold tracking-tight">Inbox</h1>
          <p className="mt-3 text-lg leading-8 text-neutral-600 dark:text-neutral-300">Connect your Stellar wallet to open your Inbox.</p>
          <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Your wallet may ask you to sign a message to verify this wallet. This does not send a Stellar transaction.</p>
          <button type="button" disabled={opening || wallet.busy || wallet.authBusy} onClick={() => void openInbox()} className="mt-7 flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white disabled:opacity-50">
            {opening || wallet.busy || wallet.authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <WalletCards className="h-4 w-4" />}
            {opening || wallet.authBusy ? 'Verifying wallet…' : wallet.busy ? 'Opening wallets…' : 'Connect wallet'}
          </button>
          {(openError || wallet.error) && <p className="mt-4 text-sm text-red-700 dark:text-red-300">{openError || wallet.error}</p>}
        </section>
      </main>
    </StellarWorkspaceShell>
  );
}
