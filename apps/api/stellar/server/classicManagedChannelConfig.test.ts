import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClassicManagedChannelConfigurationError,
  configuredClassicManagedChannels,
  deriveClassicManagedChannel,
  expandableClassicManagedChannels,
  MAX_CHANNELS_PER_NETWORK,
} from './classicManagedChannelConfig.js';

const MASTER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test('managed Classic channel config deterministically derives network-scoped public identities', () => {
  const first = configuredClassicManagedChannels('testnet', MASTER, '4').map((item) => item.publicKey());
  const replay = configuredClassicManagedChannels('testnet', MASTER, '4').map((item) => item.publicKey());
  const publicNetwork = configuredClassicManagedChannels('public', MASTER, '4').map((item) => item.publicKey());

  assert.deepEqual(replay, first);
  assert.equal(new Set(first).size, 4);
  assert.equal(publicNetwork.length, 4);
  assert.equal(first.some((address) => publicNetwork.includes(address)), false);
});

test('Testnet expansion preserves baseline identities and deterministically continues the derivation sequence', () => {
  const baseline = configuredClassicManagedChannels('testnet', MASTER, '4');
  const expansion = expandableClassicManagedChannels('testnet', MASTER, '4');

  assert.equal(expansion.length, MAX_CHANNELS_PER_NETWORK - 4);
  assert.equal(expansion[0]?.publicKey(), deriveClassicManagedChannel('testnet', 4, MASTER)?.publicKey());
  assert.equal(expansion.at(-1)?.publicKey(), deriveClassicManagedChannel('testnet', MAX_CHANNELS_PER_NETWORK - 1, MASTER)?.publicKey());
  assert.equal(new Set([...baseline, ...expansion].map((item) => item.publicKey())).size, MAX_CHANNELS_PER_NETWORK);
  assert.deepEqual(expandableClassicManagedChannels('public', MASTER, '4'), []);
});

test('managed Classic channel config returns no channels when the deployment secret is absent', () => {
  assert.deepEqual(configuredClassicManagedChannels('testnet', undefined, '4'), []);
});

test('managed Classic channel config fails closed on weak master secret or invalid pool size', () => {
  assert.throws(
    () => configuredClassicManagedChannels('testnet', 'too-short', '4'),
    (cause: unknown) => cause instanceof ClassicManagedChannelConfigurationError,
  );
  for (const value of ['0', '65', '1.5', 'not-a-number']) {
    assert.throws(
      () => configuredClassicManagedChannels('testnet', MASTER, value),
      (cause: unknown) => cause instanceof ClassicManagedChannelConfigurationError,
    );
  }
});
