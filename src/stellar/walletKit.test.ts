import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWalletAuthEntrySigningUnsupported,
  isWalletMessageSigningUnsupported,
  isWalletSelectionCancelled,
  walletActionErrorMessage,
} from './walletKit.js';

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
