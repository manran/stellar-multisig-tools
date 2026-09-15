import { Address, StrKey, hash, scValToNative, xdr } from '@stellar/stellar-sdk/base';
import { previewSorobanValue } from './sorobanInspection.js';

const MAX_EFFECT_PREVIEWS = 50;
const LOW_BPS = 50;      // 0.5%
const MEDIUM_BPS = 200;  // 2%
const HIGH_BPS = 500;    // 5%

export type SorobanStateEffectKind = 'created' | 'updated' | 'deleted';
export type SorobanEffectsDiffKind = 'unchanged' | 'numeric' | 'structural';
export type SorobanEffectsDiffSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface SorobanStateEffectPreview {
  kind: SorobanStateEffectKind;
  ledgerKeyType: string;
  keyPreview: string;
  beforePreview: string | null;
  afterPreview: string | null;
}

export interface SorobanEventEffectPreview {
  type: 'contract' | 'system';
  contractId: string | null;
  topics: string[];
  data: string;
}

export interface SorobanNumericEffect {
  key: string;
  label: string;
  value: string;
}

export interface SorobanEffectsSnapshot {
  version: 1;
  digest: string;
  structureDigest: string;
  stateChangeCount: number;
  eventCount: number;
  stateChanges: SorobanStateEffectPreview[];
  events: SorobanEventEffectPreview[];
  numericEffects: SorobanNumericEffect[];
  truncated: boolean;
}

export interface SorobanNumericEffectDiff {
  key: string;
  label: string;
  expected: string;
  actual: string;
  difference: string;
  basisPoints: number | null;
}

export interface SorobanEffectsDiff {
  version: 1;
  kind: SorobanEffectsDiffKind;
  severity: SorobanEffectsDiffSeverity;
  requiresExplicitReview: boolean;
  requiresReauthorization: boolean;
  expectedDigest: string;
  currentDigest: string;
  structureChanged: boolean;
  maxChangeBasisPoints: number | null;
  numericChanges: SorobanNumericEffectDiff[];
}

interface RawStateChange {
  key: string;
  before: string | null;
  after: string | null;
}

interface CanonicalStateEffect {
  keyXdr: string;
  beforeXdr: string | null;
  afterXdr: string | null;
  beforeStructure: unknown;
  afterStructure: unknown;
  preview: SorobanStateEffectPreview;
  numericEffects: SorobanNumericEffect[];
}

interface CanonicalEventEffect {
  xdr: string;
  structure: unknown;
  preview: SorobanEventEffectPreview;
  numericEffects: SorobanNumericEffect[];
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function digestJson(value: unknown): string {
  return bytesToHex(hash(new TextEncoder().encode(JSON.stringify(value))));
}

function short(value: string): string {
  return value.length <= 30 ? value : `${value.slice(0, 13)}…${value.slice(-12)}`;
}

function accountAddress(publicKey: xdr.PublicKey): string {
  return StrKey.encodeEd25519PublicKey(publicKey.ed25519.toBytes());
}

function normalizedLedgerEntry(entry: xdr.LedgerEntry): xdr.LedgerEntry {
  let data = entry.data;
  if (data.type === 'account') {
    const account = data.account;
    data = xdr.LedgerEntryData.account(new xdr.AccountEntry({
      accountId: account.accountId,
      balance: account.balance,
      seqNum: 0n,
      numSubEntries: account.numSubEntries,
      inflationDest: account.inflationDest,
      flags: account.flags,
      homeDomain: account.homeDomain,
      thresholds: account.thresholds,
      signers: account.signers,
      ext: account.ext,
    }));
  }
  return new xdr.LedgerEntry({ lastModifiedLedgerSeq: 0, data, ext: entry.ext });
}

function ledgerEntryPreview(entry: xdr.LedgerEntry | null): string | null {
  if (!entry) return null;
  switch (entry.data.type) {
    case 'account':
      return `${short(accountAddress(entry.data.account.accountId))} · ${entry.data.account.balance.toString()} stroops`;
    case 'trustline':
      return `${short(accountAddress(entry.data.trustLine.accountId))} · balance ${entry.data.trustLine.balance.toString()}`;
    case 'contractData': {
      const value = entry.data.contractData;
      return `${short(Address.fromScAddress(value.contract).toString())} · ${previewSorobanValue(scValToNative(value.key))} → ${previewSorobanValue(scValToNative(value.val))}`;
    }
    case 'contractCode':
      return `Contract code · ${short(entry.data.contractCode.hash.toString())}`;
    default:
      return entry.data.type;
  }
}

function ledgerKeyPreview(key: xdr.LedgerKey): string {
  switch (key.type) {
    case 'account': return short(accountAddress(key.account.accountId));
    case 'trustline': return short(accountAddress(key.trustLine.accountId));
    case 'contractData': return `${short(Address.fromScAddress(key.contractData.contract).toString())} · ${previewSorobanValue(scValToNative(key.contractData.key))}`;
    case 'contractCode': return `Contract code · ${short(key.contractCode.hash.toString())}`;
    default: return key.type;
  }
}

function isNumericScVal(value: xdr.ScVal): boolean {
  return value.type === 'scvU32' || value.type === 'scvI32'
    || value.type === 'scvU64' || value.type === 'scvI64'
    || value.type === 'scvU128' || value.type === 'scvI128'
    || value.type === 'scvU256' || value.type === 'scvI256';
}

function scValNumericValue(value: xdr.ScVal): bigint {
  const native = scValToNative(value);
  if (typeof native === 'bigint') return native;
  if (typeof native === 'number' && Number.isInteger(native)) return BigInt(native);
  throw new Error(`Unsupported numeric SCVal ${value.type}.`);
}

function scValStructure(value: xdr.ScVal): unknown {
  if (isNumericScVal(value)) return { type: value.type, value: '*' };
  if (value.type === 'scvVec') {
    return { type: value.type, values: (value.vec ?? []).map(scValStructure) };
  }
  if (value.type === 'scvMap') {
    return {
      type: value.type,
      entries: (value.map ?? []).map((entry) => ({
        key: entry.key.toXdr('base64'),
        value: scValStructure(entry.val),
      })),
    };
  }
  return { type: value.type, xdr: value.toXdr('base64') };
}

function numericLeaves(value: xdr.ScVal, path = 'value'): Array<{ path: string; value: bigint }> {
  if (isNumericScVal(value)) return [{ path, value: scValNumericValue(value) }];
  if (value.type === 'scvVec') {
    return (value.vec ?? []).flatMap((item, index) => numericLeaves(item, `${path}[${index}]`));
  }
  if (value.type === 'scvMap') {
    return (value.map ?? []).flatMap((entry, index) => numericLeaves(entry.val, `${path}{${index}}`));
  }
  return [];
}

function ledgerEntryStructure(entry: xdr.LedgerEntry | null): unknown {
  if (!entry) return null;
  const normalized = normalizedLedgerEntry(entry);
  if (normalized.data.type === 'account') {
    const account = normalized.data.account;
    const data = xdr.LedgerEntryData.account(new xdr.AccountEntry({
      accountId: account.accountId,
      balance: 0n,
      seqNum: 0n,
      numSubEntries: account.numSubEntries,
      inflationDest: account.inflationDest,
      flags: account.flags,
      homeDomain: account.homeDomain,
      thresholds: account.thresholds,
      signers: account.signers,
      ext: account.ext,
    }));
    return new xdr.LedgerEntry({ lastModifiedLedgerSeq: 0, data, ext: normalized.ext }).toXdr('base64');
  }
  if (normalized.data.type === 'trustline') {
    const trustLine = normalized.data.trustLine;
    const data = xdr.LedgerEntryData.trustline(new xdr.TrustLineEntry({
      accountId: trustLine.accountId,
      asset: trustLine.asset,
      balance: 0n,
      limit: trustLine.limit,
      flags: trustLine.flags,
      ext: trustLine.ext,
    }));
    return new xdr.LedgerEntry({ lastModifiedLedgerSeq: 0, data, ext: normalized.ext }).toXdr('base64');
  }
  if (normalized.data.type === 'contractData') {
    const value = normalized.data.contractData;
    return {
      type: 'contractData',
      ext: value.ext.toXdr('base64'),
      contract: value.contract.toXdr('base64'),
      key: value.key.toXdr('base64'),
      durability: value.durability.name,
      value: scValStructure(value.val),
    };
  }
  return normalized.toXdr('base64');
}

function stateNumericEffects(
  keyXdr: string,
  keyPreview: string,
  before: xdr.LedgerEntry | null,
  after: xdr.LedgerEntry | null,
): SorobanNumericEffect[] {
  const beforeData = before?.data;
  const afterData = after?.data;
  if (beforeData?.type === 'account' || afterData?.type === 'account') {
    const beforeValue = beforeData?.type === 'account' ? beforeData.account.balance : 0n;
    const afterValue = afterData?.type === 'account' ? afterData.account.balance : 0n;
    return [{ key: `state:${keyXdr}:balance`, label: `${keyPreview} · balance delta`, value: (afterValue - beforeValue).toString() }];
  }
  if (beforeData?.type === 'trustline' || afterData?.type === 'trustline') {
    const beforeValue = beforeData?.type === 'trustline' ? beforeData.trustLine.balance : 0n;
    const afterValue = afterData?.type === 'trustline' ? afterData.trustLine.balance : 0n;
    return [{ key: `state:${keyXdr}:balance`, label: `${keyPreview} · balance delta`, value: (afterValue - beforeValue).toString() }];
  }
  if (beforeData?.type === 'contractData' || afterData?.type === 'contractData') {
    const beforeLeaves = beforeData?.type === 'contractData' ? numericLeaves(beforeData.contractData.val) : [];
    const afterLeaves = afterData?.type === 'contractData' ? numericLeaves(afterData.contractData.val) : [];
    const beforeMap = new Map(beforeLeaves.map((item) => [item.path, item.value]));
    const afterMap = new Map(afterLeaves.map((item) => [item.path, item.value]));
    return [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort().map((path) => ({
      key: `state:${keyXdr}:${path}`,
      label: `${keyPreview} · ${path} delta`,
      value: ((afterMap.get(path) ?? 0n) - (beforeMap.get(path) ?? 0n)).toString(),
    }));
  }
  return [];
}

function decodeStateEffect(value: unknown): CanonicalStateEffect | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<RawStateChange>;
  if (typeof raw.key !== 'string') return null;
  if (raw.before !== null && typeof raw.before !== 'string') return null;
  if (raw.after !== null && typeof raw.after !== 'string') return null;
  const key = xdr.LedgerKey.fromXdr(raw.key, 'base64');
  if (key.type === 'ttl') return null;
  const before = raw.before ? xdr.LedgerEntry.fromXdr(raw.before, 'base64') : null;
  const after = raw.after ? xdr.LedgerEntry.fromXdr(raw.after, 'base64') : null;
  if (!before && !after) return null;
  const kind: SorobanStateEffectKind = !before ? 'created' : !after ? 'deleted' : 'updated';
  const keyXdr = key.toXdr('base64');
  const keyPreview = ledgerKeyPreview(key);
  return {
    keyXdr,
    beforeXdr: before ? normalizedLedgerEntry(before).toXdr('base64') : null,
    afterXdr: after ? normalizedLedgerEntry(after).toXdr('base64') : null,
    beforeStructure: ledgerEntryStructure(before),
    afterStructure: ledgerEntryStructure(after),
    preview: { kind, ledgerKeyType: key.type, keyPreview, beforePreview: ledgerEntryPreview(before), afterPreview: ledgerEntryPreview(after) },
    numericEffects: stateNumericEffects(keyXdr, keyPreview, before, after),
  };
}

function decodeEventEffect(value: unknown, index: number): CanonicalEventEffect | null {
  if (typeof value !== 'string' || !value) return null;
  const diagnostic = xdr.DiagnosticEvent.fromXdr(value, 'base64');
  if (!diagnostic.inSuccessfulContractCall) return null;
  const event = diagnostic.event;
  if (event.type.name !== 'contract' && event.type.name !== 'system') return null;
  const body = event.body.value;
  const contractId = event.contractId ? StrKey.encodeContract(event.contractId.toBytes()) : null;
  const label = `${event.type.name} event${contractId ? ` · ${short(contractId)}` : ''}`;
  return {
    xdr: event.toXdr('base64'),
    structure: {
      type: event.type.name,
      contractId,
      topics: body.topics.map((topic) => topic.toXdr('base64')),
      data: scValStructure(body.data),
    },
    preview: { type: event.type.name, contractId, topics: body.topics.map((topic) => previewSorobanValue(scValToNative(topic))), data: previewSorobanValue(scValToNative(body.data)) },
    numericEffects: numericLeaves(body.data).map((item) => ({ key: `event:${index}:${item.path}`, label: `${label} · ${item.path}`, value: item.value.toString() })),
  };
}

export function emptySorobanEffectsSnapshot(): SorobanEffectsSnapshot {
  return sorobanEffectsSnapshot([], []);
}

export function sorobanEffectsSnapshot(stateChangesValue: unknown, eventsValue: unknown): SorobanEffectsSnapshot {
  const stateEffects = (Array.isArray(stateChangesValue) ? stateChangesValue : [])
    .map(decodeStateEffect)
    .filter((item): item is CanonicalStateEffect => item !== null)
    .sort((left, right) => left.keyXdr.localeCompare(right.keyXdr)
      || String(left.beforeXdr).localeCompare(String(right.beforeXdr))
      || String(left.afterXdr).localeCompare(String(right.afterXdr)));
  const eventEffects = (Array.isArray(eventsValue) ? eventsValue : [])
    .map(decodeEventEffect)
    .filter((item): item is CanonicalEventEffect => item !== null);
  const canonical = {
    version: 1,
    stateChanges: stateEffects.map(({ keyXdr, beforeXdr, afterXdr }) => ({ keyXdr, beforeXdr, afterXdr })),
    events: eventEffects.map((item) => item.xdr),
  };
  const structure = {
    version: 1,
    stateChanges: stateEffects.map(({ keyXdr, beforeStructure, afterStructure }) => ({ keyXdr, beforeStructure, afterStructure })),
    events: eventEffects.map((item) => item.structure),
  };
  const numericEffects = [...stateEffects.flatMap((item) => item.numericEffects), ...eventEffects.flatMap((item) => item.numericEffects)]
    .sort((left, right) => left.key.localeCompare(right.key));
  return {
    version: 1,
    digest: digestJson(canonical),
    structureDigest: digestJson(structure),
    stateChangeCount: stateEffects.length,
    eventCount: eventEffects.length,
    stateChanges: stateEffects.slice(0, MAX_EFFECT_PREVIEWS).map((item) => item.preview),
    events: eventEffects.slice(0, MAX_EFFECT_PREVIEWS).map((item) => item.preview),
    numericEffects,
    truncated: stateEffects.length > MAX_EFFECT_PREVIEWS || eventEffects.length > MAX_EFFECT_PREVIEWS,
  };
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function basisPoints(expected: bigint, actual: bigint): number | null {
  if (expected === 0n) return actual === 0n ? 0 : null;
  const raw = absolute(actual - expected) * 10_000n / absolute(expected);
  return Number(raw > 1_000_000_000n ? 1_000_000_000n : raw);
}

function severityForBasisPoints(maximum: number | null): SorobanEffectsDiffSeverity {
  if (maximum === null) return 'critical';
  if (maximum <= LOW_BPS) return 'low';
  if (maximum <= MEDIUM_BPS) return 'medium';
  if (maximum <= HIGH_BPS) return 'high';
  return 'critical';
}

export function compareSorobanEffects(expected: SorobanEffectsSnapshot, current: SorobanEffectsSnapshot): SorobanEffectsDiff {
  if (expected.digest === current.digest) {
    return {
      version: 1,
      kind: 'unchanged',
      severity: 'none',
      requiresExplicitReview: false,
      requiresReauthorization: false,
      expectedDigest: expected.digest,
      currentDigest: current.digest,
      structureChanged: false,
      maxChangeBasisPoints: 0,
      numericChanges: [],
    };
  }
  if (!expected.structureDigest || expected.structureDigest !== current.structureDigest) {
    return {
      version: 1,
      kind: 'structural',
      severity: 'critical',
      requiresExplicitReview: true,
      requiresReauthorization: true,
      expectedDigest: expected.digest,
      currentDigest: current.digest,
      structureChanged: true,
      maxChangeBasisPoints: null,
      numericChanges: [],
    };
  }
  const expectedMap = new Map(expected.numericEffects.map((item) => [item.key, item]));
  const currentMap = new Map(current.numericEffects.map((item) => [item.key, item]));
  if (expectedMap.size !== currentMap.size || [...expectedMap.keys()].some((key) => !currentMap.has(key))) {
    return {
      version: 1,
      kind: 'structural',
      severity: 'critical',
      requiresExplicitReview: true,
      requiresReauthorization: true,
      expectedDigest: expected.digest,
      currentDigest: current.digest,
      structureChanged: true,
      maxChangeBasisPoints: null,
      numericChanges: [],
    };
  }
  const numericChanges = [...expectedMap.entries()].flatMap(([key, expectedEffect]) => {
    const currentEffect = currentMap.get(key)!;
    const before = BigInt(expectedEffect.value);
    const after = BigInt(currentEffect.value);
    if (before === after) return [];
    return [{
      key,
      label: expectedEffect.label,
      expected: before.toString(),
      actual: after.toString(),
      difference: (after - before).toString(),
      basisPoints: basisPoints(before, after),
    } satisfies SorobanNumericEffectDiff];
  });
  if (numericChanges.length === 0) {
    return {
      version: 1,
      kind: 'numeric',
      severity: 'none',
      requiresExplicitReview: false,
      requiresReauthorization: false,
      expectedDigest: expected.digest,
      currentDigest: current.digest,
      structureChanged: false,
      maxChangeBasisPoints: 0,
      numericChanges: [],
    };
  }
  const finite = numericChanges.map((item) => item.basisPoints).filter((item): item is number => item !== null);
  const hasUnbounded = numericChanges.some((item) => item.basisPoints === null);
  const maximum = hasUnbounded ? null : Math.max(0, ...finite);
  const severity = severityForBasisPoints(maximum);
  return {
    version: 1,
    kind: 'numeric',
    severity,
    requiresExplicitReview: severity === 'critical',
    requiresReauthorization: false,
    expectedDigest: expected.digest,
    currentDigest: current.digest,
    structureChanged: false,
    maxChangeBasisPoints: maximum,
    numericChanges,
  };
}
