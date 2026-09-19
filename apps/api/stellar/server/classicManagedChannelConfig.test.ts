import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import {
  ClassicManagedChannelConfigurationError,
  configuredClassicManagedChannels,
} from './classicManagedChannelConfig.js';

test('managed Classic channel config is network-scoped and deduplicates public identities', () => {
  const a = Keypair.random();
  const b = Keypair.random();
  const raw = JSON.stringify({
    testnet: [a.secret(), b.secret(), a.secret()],
    public: [],
  });
  assert.deepEqual(
    configuredClassicManagedChannels('testnet', raw).map((item) => item.publicKey()).sort(),
    [a.publicKey(), b.publicKey()].sort(),
  );
  assert.deepEqual(configuredClassicManagedChannels('public', raw), []);
});

test('managed Classic channel config fails closed on invalid secret material', () => {
  assert.throws(
    () => configuredClassicManagedChannels('testnet', JSON.stringify({ testnet: ['not-a-seed'] })),
    (cause: unknown) => cause instanceof ClassicManagedChannelConfigurationError,
  );
});
