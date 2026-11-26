import { Networks } from '@stellar/stellar-sdk/base';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

let initialized = false;
let hardwareModulesLoaded = false;
let walletSelectionPending = false;
let walletSelectionVersion = 0;

export function isWalletSelectionInProgress(): boolean {
  return walletSelectionPending;
}

const HARDWARE_WALLET_MODULE_TYPE = 'HW_WALLET';
const LEDGER_WALLET_ID = 'LEDGER';
const TREZOR_WALLET_ID = 'TREZOR';
const HARDWARE_WALLET_SUPPORT_EMAIL = 'support@multisig.tools';

export function nameVarialWallet<T extends { productId: string; productName: string }>(modules: T[]): T[] {
  const legacyModule = modules.find((module) => module.productId === 'freighter');
  if (legacyModule) legacyModule.productName = 'Varial';
  return modules;
}

export type WalletNetworkSource = 'wallet' | 'application';

export interface WalletIdentity {
  address: string;
  network: StellarNetwork;
  networkSource: WalletNetworkSource;
}

async function loadHardwareWalletModules() {
  // Ledger and Trezor are intentionally outside Wallets Kit defaultModules()
  // because their browser transports require a global Buffer polyfill.
  const { Buffer } = await import('buffer');
  const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
  if (!browserGlobal.Buffer) browserGlobal.Buffer = Buffer;

  const [{ LedgerModule }, { TrezorModule }] = await Promise.all([
    import('@creit.tech/stellar-wallets-kit/modules/ledger'),
    import('@creit.tech/stellar-wallets-kit/modules/trezor'),
  ]);

  const ledger = new LedgerModule();
  const ledgerGetAddresses = ledger.getAddresses.bind(ledger);
  ledger.getAddresses = async (...args: Parameters<typeof ledger.getAddresses>) => {
    try {
      return await ledgerGetAddresses(...args);
    } catch (cause) {
      throw new Error(walletActionErrorMessage(cause, 'Unable to read Ledger accounts.'));
    }
  };
  const ledgerInternals = ledger as unknown as { _transport?: { close(): Promise<void> } };
  // Wallets Kit 2.6.0 starts transport.close() without awaiting it. Its hardware
  // account picker immediately reopens WebUSB afterwards, which can leave a stale
  // Ledger HID channel in flight. Keep the upstream picker, but make disconnect
  // honor the transport lifecycle before it opens a new channel.
  ledger.disconnect = async () => {
    const transport = ledgerInternals._transport;
    try {
      if (transport) await transport.close();
    } finally {
      ledgerInternals._transport = undefined;
    }
  };

  return [
    ledger,
    new TrezorModule({
      appUrl: globalThis.location?.origin ?? 'https://stellar.multisig.tools',
      appName: 'MultiSig Tools',
      email: HARDWARE_WALLET_SUPPORT_EMAIL,
      lazyLoad: true,
    }),
  ];
}

const FALLBACK_WALLET_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="#e1e8e4"/><rect x="8" y="12" width="24" height="17" rx="3" fill="none" stroke="#315b4c" stroke-width="2"/><path d="M25 18h7v6h-7z" fill="#315b4c"/></svg>');

export function walletIconForCsp(icon: string): string {
  // Keep the current image policy. Other providers use a local generic icon.
  return /^(?:https:\/\/stellar\.creit\.tech\/wallet-icons\/|data:image\/)/.test(icon) ? icon : FALLBACK_WALLET_ICON;
}

async function loadKit(includeHardwareWallets = false) {
  const [{ StellarWalletsKit }, { defaultModules }, { selectedModuleId }] = await Promise.all([
    import('@creit.tech/stellar-wallets-kit/sdk'),
    import('@creit.tech/stellar-wallets-kit/modules/utils'),
    import('@creit.tech/stellar-wallets-kit/state'),
  ]);
  const selectedHardwareWallet = selectedModuleId.value === LEDGER_WALLET_ID
    || selectedModuleId.value === TREZOR_WALLET_ID;
  const shouldLoadHardwareWallets = includeHardwareWallets || selectedHardwareWallet;

  if (!initialized || (shouldLoadHardwareWallets && !hardwareModulesLoaded)) {
    const hardwareModules = shouldLoadHardwareWallets ? await loadHardwareWalletModules() : [];
    const modules = [...nameVarialWallet(defaultModules()), ...hardwareModules];
    for (const module of modules) module.productIcon = walletIconForCsp(module.productIcon);
    StellarWalletsKit.init({ modules });
    initialized = true;
    hardwareModulesLoaded = hardwareModulesLoaded || shouldLoadHardwareWallets;
  }

  return StellarWalletsKit;
}

function networkPassphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function networkFromPassphrase(passphrase: string): StellarNetwork {
  if (passphrase === Networks.PUBLIC) return 'public';
  if (passphrase === Networks.TESTNET) return 'testnet';
  throw new Error('This wallet is using a Stellar network that MultiSig Tools does not support.');
}

function isHardwareWalletModule(module: { moduleType?: unknown }): boolean {
  return module.moduleType === HARDWARE_WALLET_MODULE_TYPE;
}

// Popup wallets require interaction to read an address and do not expose a
// network. Use the explicit Kit selection and the application network.
export function isPopupWalletModule(module: { productId?: unknown }): boolean {
  return module.productId === 'albedo' || module.productId === 'xbull';
}

function usesApplicationNetwork(module: { moduleType?: unknown; productId?: unknown }): boolean {
  return isHardwareWalletModule(module) || isPopupWalletModule(module);
}

function isLedgerWalletModule(module: { productId?: unknown }): boolean {
  return module.productId === LEDGER_WALLET_ID;
}

function setKitNetworkContext(
  kit: Awaited<ReturnType<typeof loadKit>>,
  network: StellarNetwork,
): void {
  kit.setNetwork(networkPassphrase(network) as Parameters<typeof kit.setNetwork>[0]);
}

async function currentWalletNetwork(
  kit: Awaited<ReturnType<typeof loadKit>>,
): Promise<{ network: StellarNetwork; networkSource: WalletNetworkSource }> {
  if (usesApplicationNetwork(kit.selectedModule)) {
    // Ledger/Trezor and Albedo/xBull do not expose a wallet network. The
    // page/transaction binds the Kit's application network.
    const { selectedNetwork } = await import('@creit.tech/stellar-wallets-kit/state');
    return { network: networkFromPassphrase(selectedNetwork.value), networkSource: 'application' };
  }
  const { networkPassphrase: passphrase } = await kit.getNetwork();
  return { network: networkFromPassphrase(passphrase), networkSource: 'wallet' };
}

function walletErrorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object' && 'message' in cause) return String((cause as { message?: unknown }).message ?? '');
  return String(cause ?? '');
}

export function walletActionErrorMessage(cause: unknown, fallback: string): string {
  const message = walletErrorMessage(cause).trim();
  const lower = message.toLowerCase();
  if (lower.includes('0x5515') || lower.includes('locked device') || lower.includes('device is locked')) {
    return 'Ledger is locked. Unlock the device, open the Stellar app, then try again. (Ledger 0x5515)';
  }
  if (isWalletUserRejected(cause)) return 'You did not approve the wallet request. You can try again.';
  return message || fallback;
}

export function isWalletSelectionCancelled(cause: unknown): boolean {
  const message = walletErrorMessage(cause).toLowerCase();
  return message.includes('user closed the modal')
    || message.includes('user canceled')
    || message.includes('user cancelled')
    || message.includes('modal was closed');
}

export function isWalletUserRejected(cause: unknown): boolean {
  if (isWalletSelectionCancelled(cause)) return true;
  const message = walletErrorMessage(cause).toLowerCase();
  return message.includes('user rejected this request')
    || message.includes('rejected by user')
    || message.includes('user denied')
    || message.includes('request was rejected by the user');
}

export function isWalletMessageSigningUnsupported(cause: unknown): boolean {
  const message = walletErrorMessage(cause).toLowerCase();
  return message.includes('signmessage') && (
    message.includes('does not support')
    || message.includes('do not support')
    || message.includes('not supported')
    || message.includes('unsupported')
    || message.includes('not implemented')
    || message.includes('not a function')
  );
}

export function isWalletAuthEntrySigningUnsupported(cause: unknown): boolean {
  const message = walletErrorMessage(cause).toLowerCase();
  return message.includes('signauthentry') && (
    message.includes('does not support')
    || message.includes('do not support')
    || message.includes('not supported')
    || message.includes('unsupported')
    || message.includes('not implemented')
    || message.includes('not a function')
  );
}

/** Keep the Kit's wallet and hardware-account selection logic; provide native modal
 * focus containment and keyboard semantics for its pinned 2.6.0 list UI. */
async function accessibleWalletSelection(kit: Awaited<ReturnType<typeof loadKit>>) {
  const { closeEvent } = await import('@creit.tech/stellar-wallets-kit/state');
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog');
  dialog.className = 'mst-wallet-dialog';
  dialog.setAttribute('aria-label', 'Choose a wallet');
  const observer = new MutationObserver(() => enhance());
  let cancelRequested = false;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  function closeWhenReady() {
    // The Kit subscribes to closeEvent after refreshing wallet availability.
    // Retry the close event only while a requested cancellation is pending.
    if (!cancelRequested || !dialog.open) return;
    closeEvent.next();
    cancelTimer = setTimeout(closeWhenReady, 100);
  }
  function enhance() {
    for (const row of dialog.querySelectorAll<HTMLElement>('li')) {
      // The upstream auth and hardware-account lists use clickable li elements.
      if (!row.className.includes('cursor-pointer')) continue;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
    }
    for (const header of dialog.querySelectorAll('header')) {
      const buttons = [...header.querySelectorAll('button')];
      const close = buttons.at(-1);
      if (close && !close.getAttribute('aria-label')) close.setAttribute('aria-label', 'Close wallet selection');
      if (buttons.length > 1 && !buttons[0].getAttribute('aria-label')) {
        buttons[0].setAttribute('aria-label', header.textContent?.includes('Connect Wallet') ? 'Wallet help' : 'Back');
      }
    }
    if (document.activeElement === dialog || document.activeElement === document.body) {
      dialog.querySelector<HTMLElement>('button, li[role="button"]')?.focus();
    }
  }
  dialog.addEventListener('keydown', event => {
    const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('li[role="button"]') : null;
    if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); row.click(); }
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    if (!cancelRequested) { cancelRequested = true; closeWhenReady(); }
  });
  document.body.appendChild(dialog);
  observer.observe(dialog, { childList: true, subtree: true });
  try {
    dialog.showModal();
    return await kit.authModal({ container: dialog });
  } finally {
    observer.disconnect();
    if (cancelTimer !== undefined) clearTimeout(cancelTimer);
    dialog.close();
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
}

export async function connectWalletIdentity(preferredNetwork?: StellarNetwork): Promise<WalletIdentity> {
  if (walletSelectionPending) throw new Error('Finish the current wallet selection first.');
  walletSelectionPending = true;
  walletSelectionVersion += 1;
  try {
    const kit = await loadKit(true);
    const { activeAddress, selectedModuleId, selectedNetwork } = await import('@creit.tech/stellar-wallets-kit/state');
    const previous = { address: activeAddress.value, module: selectedModuleId.value, network: selectedNetwork.value };
    try {
      if (preferredNetwork) setKitNetworkContext(kit, preferredNetwork);
      const { address } = await accessibleWalletSelection(kit);
      if (!address) throw new Error('No Stellar account was selected.');
      return { address, ...await currentWalletNetwork(kit) };
    } catch (cause) {
      // Kit selects the module before its popup returns a public key. Restore
      // the previous pair on failure instead of pairing an old address with it.
      selectedModuleId.value = previous.module;
      activeAddress.value = previous.address;
      selectedNetwork.value = previous.network;
      throw cause;
    }
  } finally {
    walletSelectionPending = false;
  }
}

export async function getConnectedWalletIdentity(preferredNetwork?: StellarNetwork): Promise<WalletIdentity> {
  if (walletSelectionPending) throw new Error('Wallet selection is in progress.');
  const selectionVersion = walletSelectionVersion;
  const kit = await loadKit();
  const applicationNetwork = usesApplicationNetwork(kit.selectedModule);
  if (applicationNetwork && preferredNetwork) setKitNetworkContext(kit, preferredNetwork);

  // Only silently readable wallets are refreshed from their provider. Both
  // hardware and popup wallets require an explicit account selection; focus
  // events must not open another wallet window or overwrite that selection.
  const addressPromise = applicationNetwork
    ? kit.getAddress()
    : kit.selectedModule.getAddress({ skipRequestAccess: true });
  const [{ address }, networkContext] = await Promise.all([
    addressPromise,
    currentWalletNetwork(kit),
  ]);
  if (walletSelectionPending || selectionVersion !== walletSelectionVersion) throw new Error('Wallet selection changed.');
  if (!address) throw new Error('No Stellar wallet is currently connected.');
  return { address, ...networkContext };
}

export async function subscribeWalletIdentity(
  listener: (identity: WalletIdentity | null) => void,
): Promise<() => void> {
  const kit = await loadKit();
  const { KitEventType } = await import('@creit.tech/stellar-wallets-kit/types');
  let active = true;

  const refresh = () => {
    if (walletSelectionPending) return;
    void getConnectedWalletIdentity()
      .then((identity) => {
        if (active) listener(identity);
      })
      .catch(() => {
        // STATE_UPDATED can fire during Kit initialization before a wallet is
        // ready. Explicit connect/sign-in still surfaces actionable errors.
      });
  };

  const stopState = kit.on(KitEventType.STATE_UPDATED, refresh);
  const stopWallet = kit.on(KitEventType.WALLET_SELECTED, refresh);
  const stopDisconnect = kit.on(KitEventType.DISCONNECT, () => {
    if (active) listener(null);
  });

  return () => {
    active = false;
    stopState();
    stopWallet();
    stopDisconnect();
  };
}

// Address-only helpers remain useful to callers that do not need network
// context, but authentication should always use WalletIdentity.
export async function connectWalletAddress(): Promise<string> {
  return (await connectWalletIdentity()).address;
}

export async function getConnectedWalletAddress(): Promise<string> {
  return (await getConnectedWalletIdentity()).address;
}

export async function signMessageWithWallet(
  message: string,
  network: StellarNetwork,
  address: string,
): Promise<string> {
  const kit = await loadKit();
  const { signedMessage, signerAddress } = await kit.signMessage(message, {
    networkPassphrase: networkPassphrase(network),
    address,
  });
  if (!signedMessage) throw new Error('The wallet did not return a signed message.');
  if (signerAddress && signerAddress !== address) {
    throw new Error('The wallet signed the authentication message with a different Stellar account.');
  }
  return signedMessage;
}


export async function signAuthEntryWithWallet(
  preimageXdr: string,
  network: StellarNetwork,
  address: string,
): Promise<{ signatureBase64: string; signerAddress: string }> {
  const kit = await loadKit();
  const { signedAuthEntry, signerAddress } = await kit.signAuthEntry(preimageXdr, {
    networkPassphrase: networkPassphrase(network),
    address,
  });
  if (!signedAuthEntry) throw new Error('The wallet did not return a Soroban authorization signature.');
  if (signerAddress && signerAddress !== address) {
    throw new Error('The wallet signed the Soroban authorization with a different Stellar account.');
  }
  return { signatureBase64: signedAuthEntry, signerAddress: signerAddress ?? address };
}

export async function signTransactionWithWallet(
  xdr: string,
  network: StellarNetwork,
  address: string,
): Promise<string> {
  const kit = await loadKit();
  if (usesApplicationNetwork(kit.selectedModule)) setKitNetworkContext(kit, network);
  const signingOptions = {
    networkPassphrase: networkPassphrase(network),
    address,
    ...(isLedgerWalletModule(kit.selectedModule) ? { nonBlindTx: true } : {}),
  };
  // Wallets Kit 2.6.0 forwards arbitrary module options at runtime, but its
  // public signTransaction type omits Ledger's supported nonBlindTx flag.
  // Ledger must parse/display the transaction instead of falling back to signHash.
  const { signedTxXdr } = await kit.signTransaction(
    xdr,
    signingOptions as Parameters<typeof kit.signTransaction>[1],
  );
  if (!signedTxXdr) throw new Error('The wallet did not return a signed transaction.');
  return signedTxXdr;
}
