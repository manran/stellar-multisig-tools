import assert from 'node:assert/strict';
import test from 'node:test';
import type { StellarNetworkParameters } from '../../../../src/stellar/horizon.js';
import type { StellarAccountSnapshot, StellarNetwork } from '../../../../src/stellar/types.js';
import type { ClassicManagedChannelAlert } from './classicManagedChannelCreatorMonitor.js';
import { observeClassicManagedChannelCreator, sendClassicManagedChannelAlertWebhook } from './classicManagedChannelCreatorMonitor.js';
import type { ClassicManagedChannelCreatorMonitorStore, StoredClassicManagedChannelCreatorMonitor } from './classicManagedChannelCreatorMonitorStore.js';

const parameters: StellarNetworkParameters = {
  ledgerSequence: 1,
  ledgerClosedAt: '2026-09-21T00:00:00.000Z',
  baseFeeInStroops: 100,
  baseReserveInStroops: 5_000_000,
};

function account(balance: string): StellarAccountSnapshot {
  return {
    accountId: 'GCREATOR',
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    nativeBalance: balance,
    nativeSellingLiabilities: '0',
    balances: [],
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [],
  };
}

class MemoryMonitorStore implements ClassicManagedChannelCreatorMonitorStore {
  record: StoredClassicManagedChannelCreatorMonitor | null = null;

  async get() { return this.record; }

  async observe(record: StoredClassicManagedChannelCreatorMonitor) {
    const previousState = this.record?.state ?? null;
    this.record = { ...record };
    return { previousState, changed: previousState !== record.state };
  }

  async markAlerted(_network: StellarNetwork, _state: StoredClassicManagedChannelCreatorMonitor['state'], alertedAt: string) {
    if (this.record) this.record.alertedAt = alertedAt;
  }
}

test('creator monitor alerts only on low/exhausted/recovered state transitions', async () => {
  const store = new MemoryMonitorStore();
  const alerts: ClassicManagedChannelAlert[] = [];
  const alertSender = async (alert: ClassicManagedChannelAlert) => { alerts.push(alert); };

  await observeClassicManagedChannelCreator({
    network: 'public', creatorAccount: 'GCREATOR', account: account('100'), parameters,
  }, { store, alertSender, now: new Date('2026-09-21T00:00:00Z') });
  assert.deepEqual(alerts, []);

  await observeClassicManagedChannelCreator({
    network: 'public', creatorAccount: 'GCREATOR', account: account('49'), parameters,
  }, { store, alertSender, now: new Date('2026-09-21T00:01:00Z') });
  assert.deepEqual(alerts.map((item) => item.event), ['creator.low_balance']);

  await observeClassicManagedChannelCreator({
    network: 'public', creatorAccount: 'GCREATOR', account: account('48'), parameters,
  }, { store, alertSender, now: new Date('2026-09-21T00:02:00Z') });
  assert.equal(alerts.length, 1);

  await observeClassicManagedChannelCreator({
    network: 'public', creatorAccount: 'GCREATOR', account: account('2'), parameters,
  }, { store, alertSender, now: new Date('2026-09-21T00:03:00Z') });
  assert.deepEqual(alerts.map((item) => item.event), ['creator.low_balance', 'creator.capacity_exhausted']);

  await observeClassicManagedChannelCreator({
    network: 'public', creatorAccount: 'GCREATOR', account: account('55'), parameters,
  }, { store, alertSender, now: new Date('2026-09-21T00:04:00Z') });
  assert.equal(alerts.length, 2);

  await observeClassicManagedChannelCreator({
    network: 'public', creatorAccount: 'GCREATOR', account: account('60'), parameters,
  }, { store, alertSender, now: new Date('2026-09-21T00:05:00Z') });
  assert.deepEqual(alerts.map((item) => item.event), [
    'creator.low_balance',
    'creator.capacity_exhausted',
    'creator.balance_recovered',
  ]);
});

test('generic alert hook posts a simple text payload over HTTPS', async () => {
  let body = '';
  const sent = await sendClassicManagedChannelAlertWebhook({
    event: 'creator.low_balance',
    network: 'public',
    creatorAccount: 'GCREATOR',
    nativeBalance: '49',
    lowThreshold: '50',
    recoveryThreshold: '60',
    requiredForNextChannel: '3.0000100',
  }, {
    url: 'https://alerts.example.test/mst',
    fetchImpl: async (_url, init) => {
      body = String(init?.body ?? '');
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(sent, true);
  assert.match(body, /creator\.low_balance/);
  assert.match(body, /balance=49 XLM/);
  await assert.rejects(
    sendClassicManagedChannelAlertWebhook({
      event: 'creator.low_balance',
      network: 'public',
      creatorAccount: 'GCREATOR',
      nativeBalance: '49',
      lowThreshold: '50',
      recoveryThreshold: '60',
      requiredForNextChannel: '3.0000100',
    }, { url: 'http://localhost/alert' }),
    /must use HTTPS/,
  );
});
