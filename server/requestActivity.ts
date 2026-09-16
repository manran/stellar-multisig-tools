import { analyzeEnvelopeSignatures } from '../src/stellar/signatureAnalysis.js';
import { mergeSignedTransactionXdr } from '../src/stellar/signatureMerge.js';
import { inspectTransactionXdr } from '../src/stellar/transactionXdr.js';
import type { ActivityEvent, ActivityFactEvent, ActivityFactType, ActivityRequestItem } from '../src/stellar/activityTypes.js';
import type { PrivateNoteRevision } from '../src/stellar/privateNote.js';
import type { SigningRequestSnapshot } from '../src/stellar/requestTypes.js';
import type { StellarNetwork, StellarSigner } from '../src/stellar/types.js';
import { isValidSigningRequestId } from './requestLocator.js';
import type {
  SigningRequestStore,
  StoredSigningRequestReadFacts,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from './requestStore.js';

interface ActivityOptions {
  network: StellarNetwork;
  accountId?: string;
  limit?: number;
  scope?: 'signer' | 'treasury';
  knownSignerAddresses?: string[];
}

interface TreasuryActivityOptions {
  network: StellarNetwork;
  limit?: number;
  knownSignerAddresses?: string[];
}

const REQUEST_SCAN_BATCH_SIZE = 6;

const EVENT_ORDER: Record<ActivityFactType, number> = {
  request_created: 0,
  private_commitment_created: 1,
  private_note_added: 2,
  private_note_revised: 2,
  approval_added: 3,
  approval_declined: 3,
  transaction_submitted: 4,
  transaction_confirmed: 5,
};

const ACTIVITY_FACT_TYPES = new Set<ActivityEvent['type']>(Object.keys(EVENT_ORDER) as ActivityFactType[]);

function isActivityFactEvent(item: ActivityEvent): item is ActivityFactEvent {
  return ACTIVITY_FACT_TYPES.has(item.type);
}

function event(
  requestId: string,
  eventId: string,
  type: ActivityFactType,
  occurredAt: string,
  extras: Partial<Pick<ActivityFactEvent, 'actorAddress' | 'actor' | 'detail' | 'ledger'>> = {},
): ActivityFactEvent {
  return { version: 1, eventId, requestId, type, occurredAt, ...extras };
}

function signerForAddress(address: string): StellarSigner {
  return { key: address, type: 'ed25519_public_key', weight: 1 };
}

function signatureActors(
  xdr: string,
  network: StellarNetwork,
  addresses: string[],
): { signatureCount: number; actorsByIndex: Map<number, string> } {
  try {
    const candidates = [...new Set(addresses)]
      .filter((address) => address.startsWith('G'))
      .map(signerForAddress);
    const analysis = analyzeEnvelopeSignatures(xdr, network, candidates, 'inner');
    const actorsByIndex = new Map<number, string>();
    for (const match of analysis.matchedSigners) {
      if (match.automatic || match.signatureIndex === undefined || actorsByIndex.has(match.signatureIndex)) continue;
      actorsByIndex.set(match.signatureIndex, match.signerKey);
    }
    return { signatureCount: analysis.signatureCount, actorsByIndex };
  } catch {
    return {
      signatureCount: inspectTransactionXdr(xdr, network).innerSignatureCount,
      actorsByIndex: new Map(),
    };
  }
}

function accountIdsForRequest(request: StoredSigningRequest): string[] {
  const inspection = inspectTransactionXdr(request.baseXdr, request.network);
  return [...new Set(inspection.sourceRequirements.map((requirement) => requirement.accountId))];
}

function sortedContributions(contributions: StoredSignatureContribution[]) {
  return [...contributions].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.digest.localeCompare(b.digest));
}

function projectContributionEvents(
  request: StoredSigningRequest,
  contributions: StoredSignatureContribution[],
  address: string,
  participantAddresses: string[],
  knownSignerAddresses: string[] = [],
): { events: ActivityFactEvent[]; participated: boolean } {
  const candidateAddresses = [...new Set([
    address,
    ...participantAddresses,
    ...(request.discoverySignerKeys ?? []),
    ...knownSignerAddresses,
  ])];
  let mergedXdr = request.baseXdr;
  const base = signatureActors(mergedXdr, request.network, candidateAddresses);
  let participated = [...base.actorsByIndex.values()].includes(address);
  const events: ActivityFactEvent[] = Array.from({ length: base.signatureCount }, (_, signatureIndex) => {
    const actorAddress = base.actorsByIndex.get(signatureIndex);
    return event(
      request.id,
      `base-approval-${signatureIndex}`,
      'approval_added',
      request.createdAt,
      actorAddress ? { actorAddress } : {},
    );
  });

  for (const contribution of sortedContributions(contributions)) {
    const merge = mergeSignedTransactionXdr(mergedXdr, contribution.signedXdr, request.network);
    if (merge.addedSignatureCount === 0) continue;
    mergedXdr = merge.mergedXdr;

    if (contribution.acceptedSignatures?.length) {
      for (const [offset, accepted] of contribution.acceptedSignatures.entries()) {
        const actorAddress = accepted.signerKey.startsWith('G') ? accepted.signerKey : undefined;
        if (actorAddress === address) participated = true;
        events.push(event(
          request.id,
          `approval-${contribution.digest}-${offset}`,
          'approval_added',
          contribution.receivedAt,
          {
            ...(actorAddress ? { actorAddress } : {}),
            ...(contribution.submittedBy ? { actor: contribution.submittedBy } : {}),
          },
        ));
      }
      continue;
    }

    // Legacy v1 contributions did not persist signer attribution. Reconstruct
    // those rows from XDR only as a compatibility/reconciliation path.
    const projection = signatureActors(mergedXdr, request.network, candidateAddresses);
    for (let offset = 0; offset < merge.addedSignatureCount; offset += 1) {
      const signatureIndex = merge.existingSignatureCount + offset;
      const actorAddress = projection.actorsByIndex.get(signatureIndex);
      if (actorAddress === address) participated = true;
      events.push(event(
        request.id,
        `approval-${contribution.digest}-${offset}`,
        'approval_added',
        contribution.receivedAt,
        {
          ...(actorAddress ? { actorAddress } : {}),
          ...(contribution.submittedBy ? { actor: contribution.submittedBy } : {}),
        },
      ));
    }
  }

  return { events, participated };
}

function privateNoteEvents(requestId: string, revisions: PrivateNoteRevision[]): ActivityFactEvent[] {
  return [...revisions]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.revisionId.localeCompare(b.revisionId))
    .map((revision, index) => event(
      requestId,
      `private-note-${revision.revisionId}`,
      index === 0 ? 'private_note_added' : 'private_note_revised',
      revision.createdAt,
      revision.actorAddress ? { actorAddress: revision.actorAddress } : {},
    ));
}

function compareEvents(a: ActivityFactEvent, b: ActivityFactEvent): number {
  return a.occurredAt.localeCompare(b.occurredAt)
    || EVENT_ORDER[a.type] - EVENT_ORDER[b.type]
    || a.eventId.localeCompare(b.eventId);
}

function mergeEvents(...groups: ActivityFactEvent[][]): ActivityFactEvent[] {
  const byId = new Map<string, ActivityFactEvent>();
  for (const group of groups) {
    for (const item of group) {
      const previous = byId.get(item.eventId);
      if (!previous) {
        byId.set(item.eventId, item);
      } else if ((!previous.actorAddress && item.actorAddress) || (!previous.actor && item.actor)) {
        byId.set(item.eventId, {
          ...previous,
          ...(item.actorAddress ? { actorAddress: item.actorAddress } : {}),
          ...(item.actor ? { actor: item.actor } : {}),
        });
      }
    }
  }
  return [...byId.values()].sort(compareEvents);
}

function synthesizedEvents(
  request: StoredSigningRequest,
  submission: StoredSubmissionResult | null,
): ActivityFactEvent[] {
  const events = [event(request.id, 'created', 'request_created', request.createdAt, {
    ...(request.creatorAddress ? { actorAddress: request.creatorAddress } : {}),
    ...(request.creatorActor ? { actor: request.creatorActor } : {}),
  })];
  if (request.privateCommitment) {
    events.push(event(
      request.id,
      'private-commitment-created',
      'private_commitment_created',
      request.privateCommitment.createdAt,
    ));
  }
  if (submission) {
    events.push(event(request.id, `submitted-${submission.transactionHash}`, 'transaction_submitted', submission.submittedAt));
    events.push(event(
      request.id,
      `confirmed-${submission.transactionHash}`,
      'transaction_confirmed',
      submission.submittedAt,
      { ledger: submission.ledger },
    ));
  }
  return events;
}

export async function recordSubmittedActivity(
  store: SigningRequestStore,
  snapshot: SigningRequestSnapshot,
  actorAddress?: string,
): Promise<void> {
  if (!store.putActivityEvent || !snapshot.submission) return;
  await store.putActivityEvent(snapshot.id, event(
    snapshot.id,
    `submitted-${snapshot.submission.transactionHash}`,
    'transaction_submitted',
    snapshot.submission.submittedAt,
    actorAddress ? { actorAddress } : {},
  ));
}

async function persistProvenParticipant(
  store: SigningRequestStore,
  request: StoredSigningRequest,
  address: string,
  events: ActivityFactEvent[],
): Promise<void> {
  if (!store.putRequestParticipant) return;
  const joinedAt = events.find((item) => item.actorAddress === address)?.occurredAt ?? request.createdAt;
  try {
    await store.putRequestParticipant(request.id, {
      version: 1,
      address,
      joinedAt,
    });
  } catch (cause) {
    // Signature participation remains the hard fact. Persisting the identity
    // projection is best-effort and must not hide Activity if Blob is transient.
    console.error('Request participant projection write failed', { requestId: request.id, address, cause });
  }
}

function isPrivateNoteEvent(item: ActivityEvent): boolean {
  return item.type === 'private_note_added' || item.type === 'private_note_revised';
}

async function activityItemForRequest(
  store: SigningRequestStore,
  request: StoredSigningRequest,
  address: string,
  options: ActivityOptions,
  readFacts?: StoredSigningRequestReadFacts,
  privateNoteRevisions?: PrivateNoteRevision[],
): Promise<ActivityRequestItem | null> {
  const accountIds = accountIdsForRequest(request);
  if (options.accountId && !accountIds.includes(options.accountId)) return null;

  const factsPromise = readFacts
    ? Promise.resolve(readFacts)
    : Promise.all([
        store.listContributions(request.id),
        store.getSubmission(request.id, request.transactionHash),
      ]).then(([contributions, submission]) => ({ contributions, submission }));
  const [facts, storedEvents, noteRevisions, participant, participants] = await Promise.all([
    factsPromise,
    store.listActivityEvents?.(request.id) ?? Promise.resolve([]),
    privateNoteRevisions
      ? Promise.resolve(privateNoteRevisions)
      : store.listPrivateNoteRevisions?.(request.id) ?? Promise.resolve([]),
    store.getRequestParticipant?.(request.id, address) ?? Promise.resolve(null),
    store.listRequestParticipants?.(request.id) ?? Promise.resolve([]),
  ]);
  const { contributions, submission } = facts;
  const projected = projectContributionEvents(
    request,
    contributions,
    address,
    participants.map((item) => item.address),
    options.knownSignerAddresses,
  );
  const viewerParticipated = projected.participated || Boolean(participant);
  if (options.scope !== 'treasury' && !viewerParticipated) return null;
  if (projected.participated && !participant) {
    await persistProvenParticipant(store, request, address, projected.events);
  }

  const storedEventsForViewer = storedEvents.filter((item): item is ActivityFactEvent =>
    isActivityFactEvent(item)
    && item.type !== 'approval_added'
    && (viewerParticipated || !isPrivateNoteEvent(item)),
  );
  const notesForViewer = viewerParticipated
    ? privateNoteEvents(request.id, [
        ...(request.initialPrivateNote ? [request.initialPrivateNote] : []),
        ...noteRevisions,
      ])
    : [];
  const events = mergeEvents(
    // v2 contributions carry canonical signer evidence captured at acceptance.
    // Legacy v1 rows fall back to XDR reconstruction above.
    storedEventsForViewer,
    synthesizedEvents(request, submission),
    notesForViewer,
    projected.events,
  );
  return {
    requestId: request.id,
    network: request.network,
    transactionHash: request.transactionHash,
    baseXdr: request.baseXdr,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    accountIds,
    events,
  };
}

function latestActivityAt(item: ActivityRequestItem): string {
  return item.events[item.events.length - 1]?.occurredAt ?? item.createdAt;
}

function compareActivityItems(a: ActivityRequestItem, b: ActivityRequestItem): number {
  return latestActivityAt(b).localeCompare(latestActivityAt(a)) || b.requestId.localeCompare(a.requestId);
}

function encodeActivityCursor(item: ActivityRequestItem): string {
  return Buffer.from(`${latestActivityAt(item)}\n${item.requestId}`, 'utf8').toString('base64url');
}

function decodeActivityCursor(value: string | undefined): { occurredAt: string; requestId: string } | null {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const newline = decoded.indexOf('\n');
    if (newline <= 0) return null;
    const occurredAt = decoded.slice(0, newline);
    const requestId = decoded.slice(newline + 1);
    if (!occurredAt || !isValidSigningRequestId(requestId)) return null;
    return { occurredAt, requestId };
  } catch {
    return null;
  }
}

function isAfterCursor(item: ActivityRequestItem, cursor: { occurredAt: string; requestId: string }): boolean {
  const occurredAt = latestActivityAt(item);
  return occurredAt < cursor.occurredAt || (occurredAt === cursor.occurredAt && item.requestId < cursor.requestId);
}

async function listActivityItems(
  store: SigningRequestStore,
  address: string,
  options: ActivityOptions,
): Promise<ActivityRequestItem[]> {
  let requests: StoredSigningRequest[];
  if (store.listRequestsByActivitySubjects) {
    const [indexed, discovery] = await Promise.all([
      store.listRequestsByActivitySubjects(
        options.network,
        options.accountId ? [options.accountId] : [],
        options.scope === 'treasury' ? '' : address,
      ),
      options.scope !== 'treasury' && store.listRequestsByDiscoverySubjects
        ? store.listRequestsByDiscoverySubjects(options.network, [], address)
        : Promise.resolve([]),
    ]);
    const byId = new Map<string, StoredSigningRequest>();
    for (const request of [...indexed, ...discovery]) byId.set(request.id, request);
    requests = [...byId.values()];
  } else {
    if (!store.listRequests) return [];
    requests = await store.listRequests();
  }
  requests = requests
    .filter((request) => isValidSigningRequestId(request.id))
    .filter((request) => request.network === options.network)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const items: ActivityRequestItem[] = [];
  for (let index = 0; index < requests.length; index += REQUEST_SCAN_BATCH_SIZE) {
    const batch = requests.slice(index, index + REQUEST_SCAN_BATCH_SIZE);
    const results = await Promise.all(batch.map((request) =>
      activityItemForRequest(store, request, address, options),
    ));
    for (const item of results) {
      if (item) items.push(item);
    }
  }
  return items.sort(compareActivityItems);
}

async function activityPage(
  store: SigningRequestStore,
  address: string,
  options: ActivityOptions & { cursor?: string },
): Promise<{ items: ActivityRequestItem[]; nextCursor?: string }> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  const cursor = decodeActivityCursor(options.cursor);
  const all = await listActivityItems(store, address, options);
  const filtered = cursor ? all.filter((item) => isAfterCursor(item, cursor)) : all;
  const page = filtered.slice(0, limit);
  return {
    items: page,
    ...(filtered.length > limit && page.length > 0 ? { nextCursor: encodeActivityCursor(page[page.length - 1]) } : {}),
  };
}

export async function listSignerActivityItems(
  store: SigningRequestStore,
  address: string,
  options: { network: StellarNetwork; knownSignerAddresses?: string[] },
): Promise<ActivityRequestItem[]> {
  return listActivityItems(store, address, { ...options, scope: 'signer' });
}

export async function listSignerActivityPage(
  store: SigningRequestStore,
  address: string,
  options: ActivityOptions & { cursor?: string },
) {
  return activityPage(store, address, { ...options, scope: 'signer' });
}

export async function listTreasuryActivityPage(
  store: SigningRequestStore,
  address: string,
  accountId: string,
  options: TreasuryActivityOptions & { cursor?: string },
) {
  return activityPage(store, address, {
    ...options,
    accountId,
    scope: 'treasury',
  });
}

export async function listSignerActivity(
  store: SigningRequestStore,
  address: string,
  options: ActivityOptions,
): Promise<ActivityRequestItem[]> {
  return (await listSignerActivityPage(store, address, options)).items;
}

export async function listTreasuryActivity(
  store: SigningRequestStore,
  address: string,
  accountId: string,
  options: TreasuryActivityOptions,
): Promise<ActivityRequestItem[]> {
  return (await listTreasuryActivityPage(store, address, accountId, options)).items;
}

export async function getSignerActivityItem(
  store: SigningRequestStore,
  address: string,
  requestId: string,
  options: ActivityOptions,
): Promise<ActivityRequestItem | null> {
  const request = await store.getRequest(requestId);
  if (!request || request.network !== options.network || !isValidSigningRequestId(request.id)) return null;
  return getSignerActivityItemForRequest(store, address, request, options);
}

export async function getSignerActivityItemForRequest(
  store: SigningRequestStore,
  address: string,
  request: StoredSigningRequest,
  options: ActivityOptions,
  readFacts?: StoredSigningRequestReadFacts,
  privateNoteRevisions?: PrivateNoteRevision[],
): Promise<ActivityRequestItem | null> {
  if (request.network !== options.network || !isValidSigningRequestId(request.id)) return null;
  return activityItemForRequest(
    store,
    request,
    address,
    { ...options, scope: 'signer' },
    readFacts,
    privateNoteRevisions,
  );
}

export async function getTreasuryActivityItem(
  store: SigningRequestStore,
  address: string,
  requestId: string,
  accountId: string,
  options: TreasuryActivityOptions,
): Promise<ActivityRequestItem | null> {
  const request = await store.getRequest(requestId);
  if (!request || request.network !== options.network || !isValidSigningRequestId(request.id)) return null;
  return getTreasuryActivityItemForRequest(store, address, request, accountId, options);
}

export async function getTreasuryActivityItemForRequest(
  store: SigningRequestStore,
  address: string,
  request: StoredSigningRequest,
  accountId: string,
  options: TreasuryActivityOptions,
  readFacts?: StoredSigningRequestReadFacts,
  privateNoteRevisions?: PrivateNoteRevision[],
): Promise<ActivityRequestItem | null> {
  if (request.network !== options.network || !isValidSigningRequestId(request.id)) return null;
  return activityItemForRequest(store, request, address, {
    ...options,
    accountId,
    scope: 'treasury',
  }, readFacts, privateNoteRevisions);
}
