import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const ui = source('../MultiSigUi.tsx');
const payment = source('../PaymentComposer.tsx');
const claimable = source('../ClaimablePaymentComposer.tsx');
const transfer = source('../TransferComposer.tsx');
const designer = source('../MultisigDesignerApp.tsx');
const newTransaction = source('../NewTransactionApp.tsx');
const signingRoom = source('../SigningRoomApp.tsx');
const accountSigningEntry = source('../AccountSigningEntryApp.tsx');
const accountControl = source('../StellarAccountControl.tsx');
const header = source('../StellarHeader.tsx');
const request = source('../RequestApp.tsx');
const receipt = source('../TransactionReceiptApp.tsx');
const treasury = source('../TreasuryApp.tsx');
const activity = source('../ActivityApp.tsx');
const treasurySettings = source('../TreasuryBoxSettingsApp.tsx');
const workspaceShell = source('../StellarWorkspaceShell.tsx');
const product = source('../../../internal-docs/content/stellar/product/human-product-contract.md');
const uxDesignSystem = source('../../../internal-docs/content/stellar/product/ux-design-system.md');

const symmetricNetworkToggle = /\(\['public', 'testnet'\] as StellarNetwork\[\]\)\.map/;

test('normal Human composers inherit network instead of exposing a symmetric switch', () => {
  for (const surface of [payment, claimable, transfer, designer]) {
    assert.doesNotMatch(surface, symmetricNetworkToggle);
    assert.doesNotMatch(surface, /onNetworkChange/);
  }
  assert.match(payment, /<NetworkBadge network=\{network\} \/>/);
  assert.match(claimable, /<NetworkBadge network=\{network\} \/>/);
  assert.match(transfer, /<NetworkBadge network=\{network\} \/>/);
  assert.match(designer, /<NetworkBadge network=\{network\} \/>/);
});

test('ordinary Mainnet chrome is implicit while transaction facts can name either network', () => {
  assert.match(ui, /if \(network === 'public'\) return null;/);
  assert.match(ui, /export function NetworkFact/);
  assert.match(accountControl, /return network === 'testnet' \? 'Testnet' : '';/);
  assert.match(request, /<NetworkFact network=\{snapshot\.network\} \/>/);
  assert.match(receipt, /<NetworkFact network=\{snapshot\.network\} long \/>/);
  assert.match(signingRoom, /<NetworkFact network=\{network\} \/>/);
});

test('fixed deployments remove network guessing while dual local compatibility keeps one fallback primitive', () => {
  assert.match(ui, /fixedClientStellarDeploymentNetwork/);
  assert.match(ui, /deployment is restricted to one Stellar network/);
  assert.match(header, /fixedDeploymentNetwork && <NetworkBadge network=\{fixedDeploymentNetwork\}/);
  assert.match(newTransaction, /<NetworkFallbackChoice/);
  assert.match(newTransaction, /inspectTransactionXdr\(value, network\)/);
  assert.doesNotMatch(newTransaction, /resolveImportedTransactionNetwork/);
  assert.match(signingRoom, /<NetworkFact network=\{network\}/);
  assert.doesNotMatch(signingRoom, /NetworkFallbackChoice|resolveImportedTransactionNetwork/);
  assert.match(accountSigningEntry, /<NetworkFallbackChoice/);
  assert.doesNotMatch(newTransaction, symmetricNetworkToggle);
  assert.doesNotMatch(signingRoom, symmetricNetworkToggle);
  assert.doesNotMatch(accountSigningEntry, symmetricNetworkToggle);
});

test('networkless hardware follows the deployment/work-object network without pretending the device switched networks', () => {
  assert.match(workspaceShell, /resolveStellarNetwork\(networkContext, sessionNetwork\)/);
  assert.match(workspaceShell, /alignNetworkContext\(networkContext\)/);
  assert.match(request, /walletNetworkSource === 'wallet'/);
  assert.match(receipt, /networkSource === 'application' && requestedNetwork/);
  assert.match(receipt, /networkSource === 'wallet' && requestedNetwork !== connectedNetwork/);
  assert.match(treasury, /networkSource === 'application' && route\.network/);
  assert.match(activity, /networkSource === 'application' && route\.network/);
  assert.match(accountControl, /fixedClientStellarDeploymentNetwork/);
  assert.match(accountControl, /network && !fixedDeploymentNetwork/);
  assert.match(accountControl, /Hardware wallet network/);
  assert.match(accountControl, /selectNetworkContext\(candidate\)/);
});

test('deployment policy outranks URL, Human, and WalletKit application defaults', () => {
  const walletContext = source('../StellarWalletContext.tsx');
  assert.match(walletContext, /FIXED_DEPLOYMENT_NETWORK = fixedClientStellarDeploymentNetwork\(\)/);
  assert.match(walletContext, /identity\.networkSource === 'application'[\s\S]*resolveNetworklessWalletContext\(identity\.network, explicitNetworkRef\.current\)/);
  assert.match(walletContext, /requestedNetwork = FIXED_DEPLOYMENT_NETWORK \?\? preferredNetwork \?\? explicitNetworkRef\.current \?\? undefined/);
  assert.match(walletContext, /rememberExplicitNetwork\(effectiveTargetNetwork\)/);
  assert.match(walletContext, /getConnectedWalletIdentity\(effectiveTargetNetwork\)/);
  assert.match(accountControl, /selectNetworkContext\(candidate\)/);
});

test('product and design contracts freeze deployment-owned network safety', () => {
  assert.match(product, /Mainnet and Testnet use separate production deployments and domains/);
  assert.match(product, /stellar\.multisig\.tools.*Mainnet/);
  assert.match(product, /testnet\.multisig\.tools.*Testnet/);
  assert.match(product, /dual.*only for local compatibility/);
  assert.match(product, /deployment network outranks URL parameters/);
  assert.match(product, /never probes both ledgers/);
  assert.match(product, /Ledger\/Trezor remain networkless signer transports/);
  assert.match(product, /GET \/api\/runtime-config/);
  assert.match(uxDesignSystem, /Mainnet implicit/);
  assert.match(uxDesignSystem, /Testnet explicit/);
  assert.match(uxDesignSystem, /No production network chooser/);
  assert.match(uxDesignSystem, /Hardware inherits deployment/);
  assert.match(uxDesignSystem, /does not encode its passphrase/);
  assert.match(uxDesignSystem, /does not query both ledgers/);
});
