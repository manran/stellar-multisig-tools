import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classicManagedChannelSoftLimit,
  ClassicManagedChannelConfigurationError,
  configuredClassicManagedChannelInitialBalance,
  deriveClassicManagedChannelCreator,
  configuredClassicManagedChannels,
  deriveClassicManagedChannel,
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

test('managed Classic derivation continues beyond the default soft limit', () => {
  const at63 = deriveClassicManagedChannel('testnet', 63, MASTER);
  const at64 = deriveClassicManagedChannel('testnet', 64, MASTER);
  const farBeyond = deriveClassicManagedChannel('testnet', 4096, MASTER);

  assert.ok(at63);
  assert.ok(at64);
  assert.ok(farBeyond);
  assert.notEqual(at63.publicKey(), at64.publicKey());
  assert.notEqual(at64.publicKey(), farBeyond.publicKey());
  assert.equal(classicManagedChannelSoftLimit(undefined), 64);
  assert.equal(classicManagedChannelSoftLimit('128'), 128);
});

test('managed Classic creator is a separate deterministic identity and initial balance config fails closed', () => {
  const creator = deriveClassicManagedChannelCreator('testnet', MASTER);
  const creatorReplay = deriveClassicManagedChannelCreator('testnet', MASTER);
  const firstChannel = deriveClassicManagedChannel('testnet', 0, MASTER);
  const publicCreator = deriveClassicManagedChannelCreator('public', MASTER);
  assert.ok(creator);
  assert.equal(creator.publicKey(), creatorReplay?.publicKey());
  assert.notEqual(creator.publicKey(), firstChannel?.publicKey());
  assert.notEqual(creator.publicKey(), publicCreator?.publicKey());
  assert.equal(configuredClassicManagedChannelInitialBalance(undefined), '10');

  for (const value of ['0', '-1', '1.00000001', 'nope']) {
    assert.throws(
      () => configuredClassicManagedChannelInitialBalance(value),
      (cause: unknown) => cause instanceof ClassicManagedChannelConfigurationError,
    );
  }
});

test('managed Classic channel config returns no channels when the deployment secret is absent', () => {
  assert.deepEqual(configuredClassicManagedChannels('testnet', undefined, '4'), []);
});

test('managed Classic channel config fails closed on weak master secret or invalid positive integer settings', () => {
  assert.throws(
    () => configuredClassicManagedChannels('testnet', 'too-short', '4'),
    (cause: unknown) => cause instanceof ClassicManagedChannelConfigurationError,
  );
  for (const value of ['0', '-1', '1.5', 'not-a-number']) {
    assert.throws(
      () => configuredClassicManagedChannels('testnet', MASTER, value),
      (cause: unknown) => cause instanceof ClassicManagedChannelConfigurationError,
    );
    assert.throws(
      () => classicManagedChannelSoftLimit(value),
      (cause: unknown) => cause instanceof ClassicManagedChannelConfigurationError,
    );
  }
});
