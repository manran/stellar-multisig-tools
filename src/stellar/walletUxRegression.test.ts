import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const walletContext = readFileSync(new URL('../StellarWalletContext.tsx', import.meta.url), 'utf8');
const walletKit = readFileSync(new URL('./walletKit.ts', import.meta.url), 'utf8');
const packageJson = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const privateWorkspaceUnlock = readFileSync(new URL('../PrivateWorkspaceUnlock.tsx', import.meta.url), 'utf8');
const activityRetention = readFileSync(new URL('../ActivityRetentionNotice.tsx', import.meta.url), 'utf8');
const landing = readFileSync(new URL('../StellarLandingApp.tsx', import.meta.url), 'utf8');
const footer = readFileSync(new URL('../StellarFooter.tsx', import.meta.url), 'utf8');
const workspaceShell = readFileSync(new URL('../StellarWorkspaceShell.tsx', import.meta.url), 'utf8');
const accountControl = readFileSync(new URL('../StellarAccountControl.tsx', import.meta.url), 'utf8');
const inbox = readFileSync(new URL('../InboxApp.tsx', import.meta.url), 'utf8');
const request = readFileSync(new URL('../RequestApp.tsx', import.meta.url), 'utf8');
const uxDesignSystem = readFileSync(new URL('../../apps/internal-docs/content/stellar/product/ux-design-system.md', import.meta.url), 'utf8');

test('wallet identity is event-driven with bounded focus/visibility reconciliation', () => {
  assert.match(walletContext, /subscribeWalletIdentity/);
  assert.match(walletContext, /window\.addEventListener\('focus'/);
  assert.match(walletContext, /document\.addEventListener\('visibilitychange'/);
  assert.match(walletContext, /WALLET_IDENTITY_RETRY_MS = 250/);
  assert.doesNotMatch(walletContext, /setInterval\(|WALLET_IDENTITY_POLL_MS/);
});

test('private confirmation uses the wallet-menu duration preference without a second chooser', () => {
  assert.doesNotMatch(privateWorkspaceUnlock, /UNLOCK_DURATION_OPTIONS|Remember this wallet for/);
  assert.match(privateWorkspaceUnlock, /getDefaultUnlockDuration\(localStorage\)/);
  assert.match(privateWorkspaceUnlock, /await unlock\(unlockSeconds\)/);
  assert.match(privateWorkspaceUnlock, /Confirm in wallet…/);
  assert.doesNotMatch(activityRetention, /unlock\(3600\)/);
  assert.match(activityRetention, /await unlock\(undefined, network\)/);
});

test('landing private entry continues to Inbox in the same confirmation action', () => {
  assert.match(landing, /openPrivateDestination/);
  assert.match(landing, /await unlock\(\)/);
  assert.match(landing, /Confirm in wallet…/);
  assert.match(landing, /openPrivateDestination\(event, stellarHref\('\/inbox'\)\)/);
});

test('top-level Sign in selects a wallet and verifies workspace identity in one action', () => {
  assert.match(walletContext, /const signIn = useCallback[\s\S]*if \(unlockedAddress && unlockedNetwork\) await lock\(\)[\s\S]*await connect\(\)[\s\S]*return unlock\(durationSeconds\)/);
  assert.match(walletContext, /if \(isWalletSelectionCancelled\(cause\)\) return ''/);
  assert.match(accountControl, /onClick=\{\(\) => void signIn\(\)\}/);
  assert.match(accountControl, /'Sign in'/);
  assert.match(accountControl, /Sign in to workspace/);
});


test('wallet switching and sign out preserve the current work surface', () => {
  assert.match(accountControl, /Choose another wallet…/);
  assert.match(accountControl, /chooseAnotherWallet/);
  assert.match(accountControl, /await connect\(\)/);
  assert.match(accountControl, /async function signOutWorkspace\(\) \{\s*await signOut\(\);\s*\}/);
  assert.doesNotMatch(accountControl, /signOutWorkspace[\s\S]{0,120}navigateWorkspace\('\/'\)/);
});

test('Ledger and Trezor are explicit signer transports inside the existing wallet path', () => {
  assert.match(walletKit, /import\('@creit\.tech\/stellar-wallets-kit\/modules\/ledger'\)/);
  assert.match(walletKit, /import\('@creit\.tech\/stellar-wallets-kit\/modules\/trezor'\)/);
  assert.match(walletKit, /async function loadKit\(includeHardwareWallets = false\)/);
  assert.match(walletKit, /shouldLoadHardwareWallets = includeHardwareWallets \|\| selectedHardwareWallet/);
  assert.match(walletKit, /shouldLoadHardwareWallets \? await loadHardwareWalletModules\(\) : \[\]/);
  assert.match(walletKit, /connectWalletIdentity[\s\S]*loadKit\(true\)/);
  assert.match(walletKit, /modules: \[\.\.\.defaultModules\(\), \.\.\.hardwareModules\]/);
  assert.match(walletKit, /import\('buffer'\)/);
  assert.match(packageJson, /"buffer": "\^6\.0\.3"/);
  assert.match(walletKit, /HARDWARE_WALLET_SUPPORT_EMAIL = 'support@multisig\.tools'/);
  assert.match(walletKit, /lazyLoad: true/);
  assert.match(walletKit, /ledgerGetAddresses = ledger\.getAddresses\.bind\(ledger\)/);
  assert.match(walletKit, /walletActionErrorMessage\(cause, 'Unable to read Ledger accounts\.'\)/);
  assert.match(walletKit, /ledgerInternals = ledger as unknown as/);
  assert.match(walletKit, /if \(transport\) await transport\.close\(\)/);
  assert.match(walletKit, /ledgerInternals\._transport = undefined/);
  assert.match(walletKit, /hardware[\s\S]*\? kit\.getAddress\(\)[\s\S]*: kit\.selectedModule\.getAddress/);
  assert.match(walletKit, /if \(isHardwareWalletModule\(kit\.selectedModule\)\) setKitNetworkContext\(kit, network\)/);
  assert.match(walletKit, /WalletNetworkSource = 'wallet' \| 'application'/);
  assert.match(walletKit, /networkSource: 'application'/);
  assert.match(walletKit, /networkSource: 'wallet'/);
  assert.match(walletKit, /LEDGER_WALLET_ID = 'LEDGER'/);
  assert.match(walletKit, /isLedgerWalletModule\(kit\.selectedModule\) \? \{ nonBlindTx: true \} : \{\}/);
  assert.match(walletContext, /networkSource: WalletNetworkSource \| null/);
  assert.match(workspaceShell, /networkSource !== 'application'/);
  assert.match(workspaceShell, /alignNetworkContext\(networkContext\)/);
  assert.match(request, /walletNetworkSource === 'wallet'/);
  assert.match(walletContext, /resolveWalletIdentity\(transactionNetwork\)/);
  assert.match(walletContext, /resolveWalletIdentity\(authorizationNetwork\)/);
  assert.match(walletContext, /isWalletMessageSigningUnsupported[\s\S]*signTransactionWithWallet/);
  assert.match(accountControl, /networkSource === 'application'/);
  assert.match(accountControl, /Mainnet context/);
  assert.match(accountControl, /Hardware wallet network/);
  assert.match(accountControl, /Selected hardware wallet/);
  assert.match(accountControl, /stays selected after unplugging until you choose another wallet or sign out/);
  assert.match(accountControl, /selectNetworkContext\(candidate\)/);
  assert.doesNotMatch(inbox, /<NetworkFallbackChoice/);
  assert.doesNotMatch(indexCss, /fonts\.googleapis\.com/);
});

test('footer closes the trust story without duplicating workspace task navigation', () => {
  assert.match(footer, /Shared control\. Not custody\./);
  assert.match(footer, /href="mailto:support@multisig\.tools"/);
  assert.match(footer, /: 'Email support'}\s*<\/a>/);
  assert.doesNotMatch(footer, />\s*support@multisig\.tools\s*</);
  assert.doesNotMatch(footer, /group.label === 'Trust' && <SupportLink/);
  assert.match(footer, /MultiSig Tools directory/);
  assert.match(footer, /Docs/);
  assert.match(footer, /Privacy/);
  assert.match(footer, /Terms/);
  assert.doesNotMatch(footer, /FOOTER_GROUPS/);
  assert.match(footer, /Beta · non-custodial/);
  assert.match(footer, /Set up multisig offline/);
  assert.match(footer, /aria-label={compact \? 'Email support' : undefined}/);
  assert.match(footer, /<Mail className="h-4 w-4"/);
  assert.match(uxDesignSystem, /Trust closure and wallet confirmation/);
  assert.match(uxDesignSystem, /not a permanent polling loop/);
});
