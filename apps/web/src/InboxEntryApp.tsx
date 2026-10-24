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
          <div className="mst-kicker"><Inbox className="mr-2 inline h-4 w-4" />Private workspace</div>
          <h1 className="mt-5 text-4xl font-bold tracking-tight">Open your Inbox</h1>
          <p className="mt-3 text-lg leading-8 text-neutral-600 dark:text-neutral-300">Confirm a Stellar wallet to see proposals that need your signature, submission, or review.</p>
          <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Your wallet may ask you to sign a verification message. This does not send a Stellar transaction.</p>
          <button type="button" disabled={opening || wallet.busy || wallet.authBusy} onClick={() => void openInbox()} className="mst-action-primary mt-7">
            {opening || wallet.busy || wallet.authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <WalletCards className="h-4 w-4" />}
            {opening || wallet.authBusy ? 'Verifying wallet…' : wallet.busy ? 'Opening wallets…' : 'Connect wallet'}
          </button>
          {(openError || wallet.error) && <p className="mt-4 text-sm text-red-700 dark:text-red-300">{openError || wallet.error}</p>}
        </section>
      </main>
    </StellarWorkspaceShell>
  );
}
