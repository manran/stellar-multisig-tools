import assert from 'node:assert/strict';
import test from 'node:test';
import { Address, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk/base';
import { compareSorobanEffects, sorobanEffectsSnapshot } from '../../packages/stellar-core/src/sorobanEffects.js';

const CONTRACT = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';

function contractState(value: number, lastModifiedLedgerSeq = 10) {
  const contract = new Address(CONTRACT).toScAddress();
  const keyValue = nativeToScVal('balance');
  const key = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract,
    key: keyValue,
    durability: xdr.ContractDataDurability.persistent,
  }));
  const entry = new xdr.LedgerEntry({
    lastModifiedLedgerSeq,
    data: xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({
      ext: xdr.ExtensionPoint.v0(), contract, key: keyValue,
      durability: xdr.ContractDataDurability.persistent,
      val: nativeToScVal(value, { type: 'u32' }),
    })),
    ext: xdr.LedgerEntryExt.v0(),
  });
  return { key, entry };
}

function rawState(before: xdr.LedgerEntry | null, after: xdr.LedgerEntry | null, key: xdr.LedgerKey) {
  return { key: key.toXdr('base64'), before: before?.toXdr('base64') ?? null, after: after?.toXdr('base64') ?? null };
}
function accountState(sequence: bigint, lastModifiedLedgerSeq: number) {
  const account = Keypair.random();
  const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({
    accountId: xdr.PublicKey.publicKeyTypeEd25519(account.rawPublicKey()),
  }));
  const entry = new xdr.LedgerEntry({
    lastModifiedLedgerSeq,
    data: xdr.LedgerEntryData.account(new xdr.AccountEntry({
      accountId: xdr.PublicKey.publicKeyTypeEd25519(account.rawPublicKey()),
      balance: 100_000_000n,
      seqNum: sequence,
      numSubEntries: 0,
      inflationDest: null,
      flags: 0,
      homeDomain: '',
      thresholds: new xdr.Thresholds(new Uint8Array([1, 1, 1, 1])),
      signers: [],
      ext: xdr.AccountEntryExt.v0(),
    })),
    ext: xdr.LedgerEntryExt.v0(),
  });
  return { key, entry };
}

function event(type: 'contract' | 'system' | 'diagnostic', successful: boolean, amount: number, topic = 'transfer') {
  const contractEvent = new xdr.ContractEvent({
    ext: xdr.ExtensionPoint.v0(),
    contractId: null,
    type: xdr.ContractEventType[type],
    body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({
      topics: [nativeToScVal(topic)],
      data: nativeToScVal(amount, { type: 'u32' }),
    })),
  });
  return new xdr.DiagnosticEvent({ inSuccessfulContractCall: successful, event: contractEvent }).toXdr('base64');
}
test('effect digest ignores ledger metadata and account sequence noise', () => {
  const contractA = contractState(7, 100);
  const contractB = contractState(7, 999);
  const accountA = accountState(5n, 100);
  if (accountA.entry.data.type !== 'account') throw new Error('expected account entry');
  const accountB = new xdr.LedgerEntry({
    lastModifiedLedgerSeq: 999,
    data: xdr.LedgerEntryData.account(new xdr.AccountEntry({
      accountId: accountA.entry.data.account.accountId,
      balance: accountA.entry.data.account.balance,
      seqNum: 500n,
      numSubEntries: accountA.entry.data.account.numSubEntries,
      inflationDest: accountA.entry.data.account.inflationDest,
      flags: accountA.entry.data.account.flags,
      homeDomain: accountA.entry.data.account.homeDomain,
      thresholds: accountA.entry.data.account.thresholds,
      signers: accountA.entry.data.account.signers,
      ext: accountA.entry.data.account.ext,
    })),
    ext: xdr.LedgerEntryExt.v0(),
  });
  const first = sorobanEffectsSnapshot([
    rawState(null, contractA.entry, contractA.key),
    rawState(null, accountA.entry, accountA.key),
  ], []);
  const second = sorobanEffectsSnapshot([
    rawState(null, accountB, accountA.key),
    rawState(null, contractB.entry, contractB.key),
  ], []);
  assert.equal(first.digest, second.digest);
  assert.equal(first.stateChangeCount, 2);
});

test('effect digest changes when a real ledger value changes', () => {
  const before = contractState(7);
  const afterA = contractState(8);
  const afterB = contractState(9);
  const first = sorobanEffectsSnapshot([rawState(before.entry, afterA.entry, before.key)], []);
  const second = sorobanEffectsSnapshot([rawState(before.entry, afterB.entry, before.key)], []);
  assert.notEqual(first.digest, second.digest);
  assert.match(first.stateChanges[0]?.afterPreview ?? '', /8/);
});
test('TTL changes are excluded from the security effect digest', () => {
  const keyHash = new Uint8Array(32).fill(7);
  const key = xdr.LedgerKey.ttl(new xdr.LedgerKeyTtl({ keyHash }));
  const before = new xdr.LedgerEntry({
    lastModifiedLedgerSeq: 10,
    data: xdr.LedgerEntryData.ttl(new xdr.TtlEntry({ keyHash, liveUntilLedgerSeq: 100 })),
    ext: xdr.LedgerEntryExt.v0(),
  });
  const after = new xdr.LedgerEntry({
    lastModifiedLedgerSeq: 11,
    data: xdr.LedgerEntryData.ttl(new xdr.TtlEntry({ keyHash, liveUntilLedgerSeq: 500 })),
    ext: xdr.LedgerEntryExt.v0(),
  });
  const empty = sorobanEffectsSnapshot([], []);
  const ttl = sorobanEffectsSnapshot([rawState(before, after, key)], []);
  assert.equal(ttl.digest, empty.digest);
  assert.equal(ttl.stateChangeCount, 0);
});

test('only successful contract/system events enter the effects digest', () => {
  const baseline = sorobanEffectsSnapshot([], [
    event('contract', true, 7),
    event('diagnostic', true, 99),
    event('system', false, 88),
  ]);
  const same = sorobanEffectsSnapshot([], [event('contract', true, 7)]);
  const changed = sorobanEffectsSnapshot([], [event('contract', true, 8)]);
  assert.equal(baseline.digest, same.digest);
  assert.equal(baseline.eventCount, 1);
  assert.notEqual(changed.digest, same.digest);
  assert.match(baseline.events[0]?.topics.join(' ') ?? '', /transfer/);
});


test('numeric outcome drift is measured without treating the effect as structural', () => {
  const before = contractState(0);
  const expectedAfter = contractState(100);
  const currentAfter = contractState(99);
  const expected = sorobanEffectsSnapshot([rawState(before.entry, expectedAfter.entry, before.key)], []);
  const current = sorobanEffectsSnapshot([rawState(before.entry, currentAfter.entry, before.key)], []);
  const diff = compareSorobanEffects(expected, current);
  assert.equal(diff.kind, 'numeric');
  assert.equal(diff.severity, 'medium');
  assert.equal(diff.requiresExplicitReview, false);
  assert.equal(diff.requiresReauthorization, false);
  assert.equal(diff.maxChangeBasisPoints, 100);
  assert.equal(diff.numericChanges[0]?.expected, '100');
  assert.equal(diff.numericChanges[0]?.actual, '99');
});

test('large numeric drift requires explicit review', () => {
  const before = contractState(0);
  const expected = sorobanEffectsSnapshot([rawState(before.entry, contractState(100).entry, before.key)], []);
  const current = sorobanEffectsSnapshot([rawState(before.entry, contractState(90).entry, before.key)], []);
  const diff = compareSorobanEffects(expected, current);
  assert.equal(diff.kind, 'numeric');
  assert.equal(diff.severity, 'critical');
  assert.equal(diff.requiresExplicitReview, true);
  assert.equal(diff.requiresReauthorization, false);
  assert.equal(diff.maxChangeBasisPoints, 1000);
});

test('recipient or event-topic changes remain structural even when amounts are similar', () => {
  const expected = sorobanEffectsSnapshot([], [event('contract', true, 100, 'transfer')]);
  const current = sorobanEffectsSnapshot([], [event('contract', true, 99, 'mint')]);
  const diff = compareSorobanEffects(expected, current);
  assert.equal(diff.kind, 'structural');
  assert.equal(diff.severity, 'critical');
  assert.equal(diff.requiresExplicitReview, true);
  assert.equal(diff.requiresReauthorization, true);
  assert.equal(diff.structureChanged, true);
});


test('shifted absolute state with the same numeric outcome delta does not become structural', () => {
  const expectedBefore = contractState(100);
  const expectedAfter = contractState(110);
  const currentBefore = contractState(200);
  const currentAfter = contractState(210);
  const expected = sorobanEffectsSnapshot([rawState(expectedBefore.entry, expectedAfter.entry, expectedBefore.key)], []);
  const current = sorobanEffectsSnapshot([rawState(currentBefore.entry, currentAfter.entry, currentBefore.key)], []);
  const diff = compareSorobanEffects(expected, current);
  assert.equal(diff.kind, 'numeric');
  assert.equal(diff.severity, 'none');
  assert.equal(diff.requiresExplicitReview, false);
  assert.equal(diff.requiresReauthorization, false);
  assert.equal(diff.maxChangeBasisPoints, 0);
});
