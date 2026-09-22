import { ChevronDown, Globe2, KeyRound, LoaderCircle, Lock, LogOut, ShieldCheck, WalletCards } from 'lucide-react';
import { useAddressBook } from './AddressBookContext';
import { useStellarWallet } from './StellarWalletContext';
import { fixedClientStellarDeploymentNetwork } from '../packages/stellar-core/src/deploymentNetwork';
import type { StellarNetwork } from '../packages/stellar-core/src/types';
import type { WalletNetworkSource } from './stellar/walletKit';
import { navigateWorkspace } from './workspaceNavigation';

function shortAddress(address: string) {
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-3)}`;
}

function visibleNetworkLabel(network: StellarNetwork | null, networkSource: WalletNetworkSource | null) {
  if (networkSource === 'application') {
    if (network === 'testnet') return 'Testnet context';
    if (network === 'public') return 'Mainnet context';
  }
  return network === 'testnet' ? 'Testnet' : '';
}

export default function StellarAccountControl() {
  const { labelFor } = useAddressBook();
  const fixedDeploymentNetwork = fixedClientStellarDeploymentNetwork();
  const {
    address,
    network,
    networkSource,
    busy,
    error,
    connect,
    signIn,
    selectNetworkContext,
    accountMenuOpen,
    setAccountMenuOpen,
    privateUnlocked,
    authBusy,
    unlock,
    lock,
    signOut,
  } = useStellarWallet();

  async function chooseAnotherWallet() {
    setAccountMenuOpen(false);
    await connect();
  }

  async function signOutWorkspace() {
    await signOut();
  }

  if (address) {
    const alias = labelFor(address, 'signer');
    const networkMismatch = fixedDeploymentNetwork && networkSource === 'wallet' && network !== fixedDeploymentNetwork;
    const networkLabel = fixedDeploymentNetwork
      ? networkMismatch
        ? `${network === 'testnet' ? 'Testnet' : 'Mainnet'} · ${fixedDeploymentNetwork === 'testnet' ? 'Testnet' : 'Mainnet'} required`
        : fixedDeploymentNetwork === 'testnet' ? 'Testnet' : ''
      : visibleNetworkLabel(network, networkSource);
    const networkTextClass = network === 'testnet' ? 'text-sky-700 dark:text-sky-300' : 'text-neutral-500 dark:text-neutral-400';

    return (
      <details
        open={accountMenuOpen}
        onToggle={(event) => setAccountMenuOpen(event.currentTarget.open)}
        className="group relative"
      >
        <summary
          title={`${alias ? `${alias} · ` : ''}${address}${networkLabel ? ` · ${networkLabel}` : ''}`}
          className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-semibold shadow-sm transition hover:bg-black/[0.03] dark:border-white/15 dark:bg-white/5 dark:hover:bg-white/10 sm:px-3.5"
        >
          <span className="max-w-[7rem] truncate sm:max-w-[11rem]">{alias || shortAddress(address)}</span>
          {networkLabel && <span className={`hidden text-xs font-semibold sm:inline ${networkTextClass}`}>{networkLabel}</span>}
          <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
        </summary>

        <div className="absolute right-0 z-50 mt-2 w-[min(21rem,calc(100vw-1rem))] rounded-2xl border border-black/10 bg-white p-2 shadow-xl dark:border-white/15 dark:bg-[#151515]">
          <div className="px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">{alias || (networkSource === 'application' ? 'Selected hardware wallet' : 'Selected wallet')}</div>
              {networkLabel && <span className={`text-xs font-semibold ${networkTextClass}`}>{networkLabel}</span>}
            </div>
            <div className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{address}</div>
          </div>

          {networkSource === 'application' && network && !fixedDeploymentNetwork && (
            <div className="my-1 border-t border-black/10 px-3 py-3 dark:border-white/10">
              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400"><Globe2 className="h-3.5 w-3.5" />Hardware wallet network</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(['public', 'testnet'] as StellarNetwork[]).map((candidate) => {
                  const selected = candidate === network;
                  return (
                    <button
                      key={candidate}
                      type="button"
                      disabled={busy || authBusy || selected}
                      aria-pressed={selected}
                      onClick={() => void selectNetworkContext(candidate)}
                      className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:cursor-default ${selected ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black' : 'border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10'}`}
                    >
                      {candidate === 'public' ? 'Mainnet' : 'Testnet'}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Ledger and Trezor use the selected MultiSig Tools network context; the device itself does not have a Stellar network setting. This hardware address stays selected after unplugging until you choose another wallet or sign out; the device is contacted only when an action needs it.</p>
            </div>
          )}

          <div className="my-1 border-t border-black/10 pt-1 dark:border-white/10">
            {!privateUnlocked && (
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void unlock()}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-emerald-700 hover:bg-emerald-500/5 disabled:opacity-50 dark:text-emerald-300"
              >
                {authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {authBusy ? 'Confirming wallet…' : 'Sign in to workspace'}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setAccountMenuOpen(false); navigateWorkspace('/agent-access'); }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10"
            >
              <KeyRound className="h-4 w-4" />
              Agent access
            </button>
            {privateUnlocked && (
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void lock()}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-neutral-600 hover:bg-black/5 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-white/10"
              >
                <Lock className="h-4 w-4" />
                Lock private workspace
              </button>
            )}
            <button
              type="button"
              disabled={busy || authBusy}
              onClick={() => void chooseAnotherWallet()}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
            >
              {busy || authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <WalletCards className="h-4 w-4" />}
              {busy ? 'Opening wallets…' : authBusy ? 'Confirming wallet…' : 'Choose another wallet…'}
            </button>
          </div>

          <button
            type="button"
            disabled={busy || authBusy}
            onClick={() => void signOutWorkspace()}
            className="mt-1 flex w-full items-center gap-2 rounded-xl border-t border-black/10 px-3 py-2.5 text-left text-sm font-semibold text-neutral-600 hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>

          {error && <div className="mx-2 mt-1 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>}
        </div>
      </details>
    );
  }

  return (
    <button
      type="button"
      disabled={busy || authBusy}
      onClick={() => void signIn()}
      className="flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-semibold shadow-sm transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.04] disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:hover:border-emerald-400/30 sm:px-3.5"
    >
      {busy || authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />}
      <span>{busy ? 'Opening wallets…' : authBusy ? 'Confirming…' : 'Sign in'}</span>
    </button>
  );
}
