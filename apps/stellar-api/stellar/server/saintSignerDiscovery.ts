import { isValidStellarAccountId } from '../../../../packages/stellar-core/src/horizon.js';

export interface SaintSignerDiscovery {
  source: 'saint';
  network: 'testnet';
  signer: string;
  status: 'available' | 'partial' | 'unavailable';
  serviceStatus: string;
  publication: { from: number; through: number; registry: string };
  scopeComplete: boolean;
  globalScopeComplete: boolean;
  classicOriginCovered: boolean;
  indexCaughtUp: boolean;
  hasMore: boolean;
  frontiers: string[];
  resources: Array<{
    address: string;
    relation: string;
    weight?: number;
    observedAtLedger?: number;
  }>;
}

export class SaintConsumerError extends Error {
  constructor(readonly code: 'saint_unavailable' | 'saint_invalid_response') {
    super(code);
    this.name = 'SaintConsumerError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new SaintConsumerError('saint_unavailable');
  const raw = await response.text();
  if (raw.length > 512_000) throw new SaintConsumerError('saint_invalid_response');
  try {
    const result = record(JSON.parse(raw) as unknown);
    if (result) return result;
  } catch {
    // Reject malformed upstream data, never present it as an empty result.
  }
  throw new SaintConsumerError('saint_invalid_response');
}

export async function discoverSaintSignerResources(
  signer: string,
  configuredUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SaintSignerDiscovery> {
  if (!isValidStellarAccountId(signer)) throw new SaintConsumerError('saint_invalid_response');
  let base: URL;
  try {
    base = new URL(configuredUrl);
  } catch {
    throw new SaintConsumerError('saint_unavailable');
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new SaintConsumerError('saint_unavailable');
  }

  let health: Record<string, unknown>;
  let report: Record<string, unknown>;
  try {
    health = await responseObject(await fetchImpl(new URL('/healthz', base), {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    }));
    if (health.network !== 'testnet' || typeof health.network_fingerprint !== 'string'
      || typeof health.registry_set_id !== 'string') {
      throw new SaintConsumerError('saint_invalid_response');
    }
    const url = new URL('/v1/signer-resources', base);
    url.searchParams.set('subject', signer);
    url.searchParams.set('kind', 'ed25519_key');
    report = await responseObject(await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    }));
  } catch (cause) {
    if (cause instanceof SaintConsumerError) throw cause;
    throw new SaintConsumerError('saint_unavailable');
  }

  const publication = record(report.publication);
  const graph = record(report.graph);
  const status = report.status;
  if (report.schema !== 'saint.signer-resources.v1'
    || !publication || !graph
    || publication.network !== health.network_fingerprint
    || publication.registry !== health.registry_set_id
    || typeof publication.from !== 'number' || typeof publication.through !== 'number'
    || !['available', 'partial', 'unavailable'].includes(String(status))
    || !Array.isArray(graph.relations) || !Array.isArray(graph.frontier)
    || !Array.isArray(report.targets) || !Array.isArray(report.continuations)
    || typeof report.global_scope_complete !== 'boolean'
    || typeof report.classic_origin_covered !== 'boolean'
    || typeof report.index_caught_up !== 'boolean'
    || typeof graph.complete_within_scope !== 'boolean') {
    throw new SaintConsumerError('saint_invalid_response');
  }

  const configured = new Set<string>();
  for (const candidate of report.targets) {
    const target = record(candidate);
    const state = record(target?.state);
    if (target?.status === 'configured' && state?.status === 'present'
      && typeof target.address === 'string' && /^[GC][A-Z2-7]{55}$/.test(target.address)) {
      configured.add(target.address);
    }
  }
  const resources: SaintSignerDiscovery['resources'] = [];
  const seen = new Set<string>();
  for (const item of graph.relations) {
    const edge = record(item);
    const proof = record(edge?.proof);
    const conditions = record(edge?.conditions);
    if (edge?.from !== 'ed25519_key:' + signer || typeof edge?.to !== 'string'
      || !edge.to.startsWith('address:') || typeof edge.kind !== 'string'
      || proof?.source !== 'stellar_rpc') continue;
    const address = edge.to.slice('address:'.length);
    if (!configured.has(address) || seen.has(address)) continue;
    seen.add(address);
    resources.push({
      address,
      relation: edge.kind,
      ...(typeof conditions?.weight === 'number' && conditions.weight > 0 ? { weight: conditions.weight } : {}),
      ...(typeof proof.observed_at_ledger === 'number' ? { observedAtLedger: proof.observed_at_ledger } : {}),
    });
  }
  resources.sort((a, b) => a.address.localeCompare(b.address));
  const frontiers = graph.frontier.map((item: unknown) => record(item)?.reason)
    .filter((value: unknown): value is string => typeof value === 'string').slice(0, 8);
  return {
    source: 'saint',
    network: 'testnet',
    signer,
    status: status as SaintSignerDiscovery['status'],
    serviceStatus: typeof health.status === 'string' ? health.status : 'unknown',
    publication: { from: publication.from as number, through: publication.through as number, registry: publication.registry as string },
    scopeComplete: graph.complete_within_scope as boolean,
    globalScopeComplete: report.global_scope_complete as boolean,
    classicOriginCovered: report.classic_origin_covered as boolean,
    indexCaughtUp: report.index_caught_up as boolean,
    hasMore: report.continuations.length > 0 || resources.length > 32,
    frontiers,
    resources: resources.slice(0, 32),
  };
}
