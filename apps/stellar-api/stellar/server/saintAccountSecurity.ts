import { isValidStellarAccountId } from '../../../../packages/stellar-core/src/horizon.js';

const MAX_WINDOW = 64_000;

export interface SaintSecurityEvent {
  id: string;
  kind: 'control' | 'lifecycle';
  ledger: number;
  occurredAt: string;
  txHash: string;
  field: string;
  signer?: string;
  before: number | null;
  after: number | null;
}

export interface SaintSecurityTimeline {
  source: 'saint';
  network: 'testnet';
  address: string;
  window: { from: number; through: number };
  complete: boolean;
  events: SaintSecurityEvent[];
}

export class SaintHistoryUnavailable extends Error {
  constructor() {
    super('Optional SAINT history is unavailable.');
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new SaintHistoryUnavailable();
  // Bound the response before parsing; no raw SAINT data is sent to the browser.
  const body = await response.text();
  if (body.length > 400_000) throw new SaintHistoryUnavailable();
  try {
    const value = object(JSON.parse(body));
    if (value) return value;
  } catch {
    // Invalid historical evidence is unavailable, not an empty security history.
  }
  throw new SaintHistoryUnavailable();
}

function validLedger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function decodeEvent(item: unknown, account: string, from: number, through: number, kind: 'control' | 'lifecycle'): SaintSecurityEvent | null {
  const row = object(item);
  if (!row || row.account_id !== account || !validLedger(row.ledger)
    || row.ledger < from || row.ledger > through
    || !validHash(row.tx_hash) || typeof row.source_key !== 'string'
    || typeof row.occurred_at !== 'string' || !Number.isFinite(Date.parse(row.occurred_at))) {
    throw new SaintHistoryUnavailable();
  }
  const id = row.source_key;
  if (kind === 'lifecycle') {
    if (row.kind !== 'account_lifecycle' || !['created', 'merged'].includes(String(row.event))) return null;
    return { id, kind, ledger: row.ledger, occurredAt: row.occurred_at, txHash: row.tx_hash, field: String(row.event), before: null, after: null };
  }
  const allowed = ['signer_weight', 'master_weight', 'low_threshold', 'medium_threshold', 'high_threshold'];
  if (row.kind !== 'account_control_change' || !allowed.includes(String(row.field))) return null;
  const before = row.before;
  const after = row.after;
  if ((before !== null && !validLedger(before)) || (after !== null && !validLedger(after))
    || (row.field === 'signer_weight' && typeof row.signer_id !== 'string')) {
    throw new SaintHistoryUnavailable();
  }
  return {
    id, kind, ledger: row.ledger, occurredAt: row.occurred_at, txHash: row.tx_hash,
    field: row.field as string, ...(typeof row.signer_id === 'string' ? { signer: row.signer_id } : {}),
    before: before as number | null, after: after as number | null,
  };
}

export async function loadSaintAccountSecurity(
  address: string,
  consumerUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<SaintSecurityTimeline> {
  if (!isValidStellarAccountId(address)) throw new SaintHistoryUnavailable();
  let base: URL;
  try {
    base = new URL(consumerUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.pathname !== '/'
      || base.username || base.password || base.search || base.hash) throw new Error('Invalid base');
  } catch {
    throw new SaintHistoryUnavailable();
  }
  // A single deadline covers both upstream calls; neither MST route nor signing awaits this call.
  const signal = AbortSignal.timeout(5_000);
  let health: Record<string, unknown>;
  let history: Record<string, unknown>;
  let from: number;
  let through: number;
  try {
    health = await jsonObject(await fetcher(new URL('/healthz', base), { signal, redirect: 'error' }));
    if (health.network !== 'testnet' || typeof health.network_fingerprint !== 'string'
      || typeof health.registry_set_id !== 'string'
      || !validLedger(health.coverage_from) || !validLedger(health.published_through)
      || health.coverage_from > health.published_through) throw new SaintHistoryUnavailable();
    through = health.published_through;
    from = Math.max(health.coverage_from, through - MAX_WINDOW + 1);
    const url = new URL('/v1/account-security-history', base);
    url.searchParams.set('address', address);
    url.searchParams.set('from', String(from));
    url.searchParams.set('through', String(through));
    history = await jsonObject(await fetcher(url, { signal, redirect: 'error' }));
  } catch {
    throw new SaintHistoryUnavailable();
  }

  const coverage = object(history.coverage);
  const window = object(coverage?.window);
  const published = object(coverage?.published);
  const families = history.families;
  if (history.address !== address || history.network_fingerprint !== health.network_fingerprint
    || !window || window.from !== from || window.through !== through
    || !published || !validLedger(published.through) || published.through < through
    || !Array.isArray(families)) throw new SaintHistoryUnavailable();

  const events: SaintSecurityEvent[] = [];
  let complete = history.complete_window === true;
  for (const familyName of ['account_control_change', 'account_lifecycle'] as const) {
    const family = families.map(object).find((item) => item?.family === familyName);
    if (!family) throw new SaintHistoryUnavailable();
    if (family.status !== 'available' || family.window_exhausted !== true) complete = false;
    // Degraded families may contain events:null; do not turn that into "no changes."
    if (family.status !== 'available') continue;
    if (!Array.isArray(family.events)) throw new SaintHistoryUnavailable();
    for (const row of family.events) {
      const event = decodeEvent(row, address, from, through, familyName === 'account_control_change' ? 'control' : 'lifecycle');
      if (event) events.push(event);
    }
  }
  events.sort((a, b) => b.ledger - a.ledger || b.id.localeCompare(a.id));
  if (events.length > 60) complete = false;
  return { source: 'saint', network: 'testnet', address, window: { from, through }, complete, events: events.slice(0, 60) };
}
