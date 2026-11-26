import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPopupWalletModule,
  isWalletAuthEntrySigningUnsupported,
  isWalletMessageSigningUnsupported,
  isWalletSelectionCancelled,
  nameVarialWallet,
  walletActionErrorMessage,
  walletIconForCsp,
} from './walletKit.js';

test('only known interactive popup wallets use a cached identity', () => {
  assert.equal(isPopupWalletModule({ productId: 'albedo' }), true);
  assert.equal(isPopupWalletModule({ productId: 'xbull' }), true);
  assert.equal(isPopupWalletModule({ productId: 'freighter' }), false);
  assert.equal(isPopupWalletModule({ productId: 'unknown' }), false);
});

test('displays Varial without changing the legacy wallet module identity', () => {
  const modules = [
    { productId: 'freighter', productName: 'Freighter' },
    { productId: 'ledger', productName: 'Ledger' },
  ];
  assert.equal(nameVarialWallet(modules), modules);
  assert.deepEqual(modules, [
    { productId: 'freighter', productName: 'Varial' },
    { productId: 'ledger', productName: 'Ledger' },
  ]);
});

test('detects closing the wallet-selection modal as cancellation', () => {
  assert.equal(isWalletSelectionCancelled({ code: -1, message: 'The user closed the modal.' }), true);
  assert.equal(isWalletSelectionCancelled(new Error('User cancelled wallet selection.')), true);
  assert.equal(isWalletSelectionCancelled(new Error('Freighter is not connected')), false);
});

test('turns Ledger locked-device status into an actionable instruction', () => {
  assert.equal(
    walletActionErrorMessage(new Error('Locked Device 0x5515'), 'fallback'),
    'Ledger is locked. Unlock the device, open the Stellar app, then try again. (Ledger 0x5515)',
  );
  assert.equal(walletActionErrorMessage(new Error('Network request failed'), 'fallback'), 'Network request failed');
});

test('detects wallets that explicitly do not support signMessage', () => {
  assert.equal(isWalletMessageSigningUnsupported(new Error("WalletConnect does not support the 'signMessage' function")), true);
  assert.equal(isWalletMessageSigningUnsupported({ message: 'signMessage is not a function' }), true);
  assert.equal(isWalletMessageSigningUnsupported({ message: 'Ledger Wallets do not support the "signMessage" function' }), true);
  assert.equal(isWalletMessageSigningUnsupported({ message: 'Trezor Wallets do not support the "signMessage" method' }), true);
});

test('does not downgrade to SEP-10 when the user rejects or another error occurs', () => {
  assert.equal(isWalletMessageSigningUnsupported(new Error('User rejected the request.')), false);
  assert.equal(isWalletMessageSigningUnsupported(new Error('Network request failed.')), false);
});

test('detects wallets that explicitly do not support detached Soroban auth-entry signing', () => {
  assert.equal(isWalletAuthEntrySigningUnsupported({ code: -3, message: 'Ledger Wallets do not support the "signAuthEntry" function' }), true);
  assert.equal(isWalletAuthEntrySigningUnsupported({ code: -3, message: 'Trezor Wallets do not support the "signAuthEntry" method' }), true);
  assert.equal(isWalletAuthEntrySigningUnsupported(new Error('User rejected the request.')), false);
  assert.equal(isWalletAuthEntrySigningUnsupported(new Error('Network request failed.')), false);
});

test('rejected wallet actions get an actionable message', () => {
  assert.equal(walletActionErrorMessage(new Error('The user rejected this request.'), 'fallback'), 'You did not approve the wallet request. You can try again.');
});

test('wallet icons obey the existing content security policy', () => {
  const allowed = 'https://stellar.creit.tech/wallet-icons/freighter.png';
  assert.equal(walletIconForCsp(allowed), allowed);
  assert.match(walletIconForCsp('https://storage.herewallet.app/logo.png'), /^data:image\/svg\+xml,/);
  assert.match(walletIconForCsp('https://stellar.creit.tech.evil.test/logo.png'), /^data:image\/svg\+xml,/);
});
