import { BlobError, get, list, put } from '@vercel/blob';
import { AccountNotFoundError, isValidStellarAccountId, loadAccount } from '../src/stellar/horizon.js';
import type { ActivityEvent, ActivityFactEvent } from '../src/stellar/activityTypes.js';
import type { PrivateNoteRevision } from '../src/stellar/privateNote.js';
import type { StellarAccountSnapshot, StellarNetwork } from '../src/stellar/types.js';
import { requestDiscoverySignerKeys, requestDiscoverySubjects } from './requestDiscovery.js';
import { isValidSigningRequestId } from './requestLocator.js';
import type {
  SigningRequestStore,
  StoredRequestParticipant,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from './requestStore.js';

export class RequestStorageUnavailableError extends Error {
  constructor(message = 'Request storage is not configured for this deployment.') {
    super(message);
    this.name = 'RequestStorageUnavailableError';
  }
}

function isMissingBlobCredentialError(cause: unknown): boolean {
  return cause instanceof BlobError && (
    cause.message.includes('No blob credentials found') ||
    cause.message.includes('no storeId was found')
  );
}

/**
 * Let @vercel/blob resolve credentials itself. On Vercel, OIDC credentials can
 * come from the request context and are not guaranteed to be represented only
 * by process.env.VERCEL_OIDC_TOKEN. A synchronous environment preflight would
 * incorrectly reject valid project-linked Blob deployments.
 */
export async function withBlobStorage<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (isMissingBlobCredentialError(cause)) {
      throw new RequestStorageUnavailableError();
    }
    throw cause;
  }
}

function requestPath(id: string): string {
  return `requests/${id}/request.json`;
}

function contributionPath(id: string, digest: string): string {
  return `requests/${id}/signatures/${digest}.json`;
}

function submissionPath(id: string, transactionHash: string): string {
  return `requests/${id}/result/${transactionHash}.json`;
}

function participantPath(id: string, address: string): string {
  return `requests/${id}/participants/${address}.json`;
}

function activityPath(id: string, eventId: string): string {
  return `requests/${id}/activity/${eventId}.json`;
}

function privateNotePath(id: string, revisionId: string): string {
  return `requests/${id}/private-note/${revisionId}.json`;
}

const DISCOVERY_INDEX_ROOT = 'request-discovery/v2';
const DISCOVERY_READY_PATH = `${DISCOVERY_INDEX_ROOT}/ready.json`;
const ACTIVITY_INDEX_ROOT = 'request-activity/v1';
const ACTIVITY_READY_PATH = `${ACTIVITY_INDEX_ROOT}/ready.json`;

function discoveryAccountPrefix(network: StellarNetwork, accountId: string): string {
  return `${DISCOVERY_INDEX_ROOT}/accounts/${network}/${accountId}/`;
}

function discoverySignerPrefix(network: StellarNetwork, signerKey: string): string {
  return `${DISCOVERY_INDEX_ROOT}/signers/${network}/${signerKey}/`;
}

function discoveryPath(prefix: string, requestId: string): string {
  return `${prefix}${requestId}.json`;
}

function activityAccountPrefix(accountId: string): string {
  return `${ACTIVITY_INDEX_ROOT}/accounts/${accountId}/`;
}

function activityAddressPrefix(address: string): string {
  return `${ACTIVITY_INDEX_ROOT}/addresses/${address}/`;
}

function activityPathForSubject(prefix: string, requestId: string): string {
  return `${prefix}${requestId}.json`;
}

async function readJson<T>(pathname: string): Promise<T | null> {
  return withBlobStorage(async () => {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream) return null;
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as T;
  });
}

const BLOB_READ_CONCURRENCY = 8;

async function readJsonBatch<T>(pathnames: string[]): Promise<T[]> {
  const values: T[] = [];
  for (let index = 0; index < pathnames.length; index += BLOB_READ_CONCURRENCY) {
    const batch = pathnames.slice(index, index + BLOB_READ_CONCURRENCY);
    const results = await Promise.all(batch.map((pathname) => readJson<T>(pathname)));
    for (const value of results) {
      if (value) values.push(value);
    }
  }
  return values;
}

async function writeIndexPaths(pathnames: string[]): Promise<void> {
  const unique = [...new Set(pathnames)];
  for (let index = 0; index < unique.length; index += BLOB_READ_CONCURRENCY) {
    const batch = unique.slice(index, index + BLOB_READ_CONCURRENCY);
    await withBlobStorage(async () => {
      await Promise.all(batch.map((pathname) => put(pathname, JSON.stringify({ indexed: true }), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      })));
    });
  }
}

async function listAllRequests(): Promise<StoredSigningRequest[]> {
  return withBlobStorage(async () => {
    const requests: StoredSigningRequest[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: 'requests/', limit: 100, cursor });
      const paths = page.blobs
        .map((blob) => blob.pathname)
        .filter((pathname) => pathname.endsWith('/request.json'));
      requests.push(...await readJsonBatch<StoredSigningRequest>(paths));
      cursor = page.cursor;
    } while (cursor);
    return requests;
  });
}

async function writeDiscoveryIndexSubjects(
  request: StoredSigningRequest,
  subjects: ReturnType<typeof requestDiscoverySubjects>,
  signerKeys: string[] = request.discoverySignerKeys ?? subjects.directSignerKeys,
): Promise<void> {
  const paths = [
    ...subjects.sourceAccountIds.map((accountId) => discoveryPath(discoveryAccountPrefix(request.network, accountId), request.id)),
    ...signerKeys.map((signerKey) => discoveryPath(discoverySignerPrefix(request.network, signerKey), request.id)),
  ];
  await withBlobStorage(async () => {
    await Promise.all(paths.map((pathname) => put(pathname, JSON.stringify({ requestId: request.id }), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
    })));
  });
}

async function writeDiscoveryIndex(request: StoredSigningRequest): Promise<void> {
  const subjects = requestDiscoverySubjects(request.baseXdr, request.network);
  await writeDiscoveryIndexSubjects(request, subjects);
}

async function writeActivityRequestIndex(request: StoredSigningRequest): Promise<void> {
  const subjects = requestDiscoverySubjects(request.baseXdr, request.network);
  const addresses = [...new Set([
    ...(request.discoverySignerKeys ?? subjects.directSignerKeys),
    ...(request.creatorAddress ? [request.creatorAddress] : []),
  ])].filter(isValidStellarAccountId);
  await writeIndexPaths([
    ...subjects.sourceAccountIds.map((accountId) =>
      activityPathForSubject(activityAccountPrefix(accountId), request.id)),
    ...addresses.map((address) =>
      activityPathForSubject(activityAddressPrefix(address), request.id)),
  ]);
}

async function writeActivityParticipantIndex(requestId: string, address: string): Promise<void> {
  await writeIndexPaths([
    activityPathForSubject(activityAddressPrefix(address), requestId),
  ]);
}

let discoveryIndexReady = false;
let discoveryIndexBuild: Promise<void> | null = null;

async function ensureDiscoveryIndex(): Promise<void> {
  if (discoveryIndexReady) return;
  if (discoveryIndexBuild) return discoveryIndexBuild;

  discoveryIndexBuild = (async () => {
    const marker = await readJson<{ version?: number }>(DISCOVERY_READY_PATH);
    if (marker?.version === 2) {
      discoveryIndexReady = true;
      return;
    }

    const requests = await listAllRequests();
    const accountCache = new Map<string, Promise<StellarAccountSnapshot | null>>();
    const discoveryAccount = (accountId: string, network: StellarNetwork) => {
      const key = `${network}:${accountId}`;
      const existing = accountCache.get(key);
      if (existing) return existing;
      const pending = loadAccount(accountId, network).catch((cause) => {
        if (cause instanceof AccountNotFoundError) return null;
        throw cause;
      });
      accountCache.set(key, pending);
      return pending;
    };

    for (const request of requests) {
      if (!isValidSigningRequestId(request.id)) continue;
      if (new Date(request.expiresAt).getTime() <= Date.now()) continue;
      let subjects: ReturnType<typeof requestDiscoverySubjects>;
      try {
        subjects = requestDiscoverySubjects(request.baseXdr, request.network);
      } catch {
        console.warn('Request discovery index skipped an unreadable request', { requestId: request.id });
        continue;
      }
      const signerKeys = request.discoverySignerKeys ?? requestDiscoverySignerKeys(
        await Promise.all(subjects.sourceAccountIds.map((accountId) => discoveryAccount(accountId, request.network))),
        subjects.directSignerKeys,
      );
      // Storage or policy-refresh failures are not swallowed: without every
      // signer pointer the v2 ready marker must not be written.
      await writeDiscoveryIndexSubjects(request, subjects, signerKeys);
    }

    await withBlobStorage(async () => {
      await put(DISCOVERY_READY_PATH, JSON.stringify({ version: 2, builtAt: new Date().toISOString() }), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
    discoveryIndexReady = true;
  })();

  try {
    await discoveryIndexBuild;
  } finally {
    if (!discoveryIndexReady) discoveryIndexBuild = null;
  }
}

let activityIndexReady = false;
let activityIndexBuild: Promise<void> | null = null;

async function activityIndexSource(): Promise<{ requests: StoredSigningRequest[]; participantPaths: string[] }> {
  const { requestPaths, participantPaths } = await withBlobStorage(async () => {
    const requestPaths: string[] = [];
    const participantPaths: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: 'requests/', limit: 100, cursor });
      for (const blob of page.blobs) {
        if (blob.pathname.endsWith('/request.json')) requestPaths.push(blob.pathname);
        const parts = blob.pathname.split('/');
        if (parts.length !== 4 || parts[0] !== 'requests' || parts[2] !== 'participants') continue;
        const requestId = parts[1];
        const filename = parts[3];
        if (!filename.endsWith('.json')) continue;
        const address = filename.slice(0, -'.json'.length);
        if (!isValidSigningRequestId(requestId) || !isValidStellarAccountId(address)) continue;
        participantPaths.push(activityPathForSubject(activityAddressPrefix(address), requestId));
      }
      cursor = page.cursor;
    } while (cursor);
    return { requestPaths, participantPaths };
  });
  return { requests: await readJsonBatch<StoredSigningRequest>(requestPaths), participantPaths };
}

async function ensureActivityIndex(): Promise<void> {
  if (activityIndexReady) return;
  if (activityIndexBuild) return activityIndexBuild;

  activityIndexBuild = (async () => {
    const marker = await readJson<{ version?: number }>(ACTIVITY_READY_PATH);
    if (marker?.version === 1) {
      activityIndexReady = true;
      return;
    }

    const { requests, participantPaths } = await activityIndexSource();
    const indexPaths: string[] = [...participantPaths];
    for (const request of requests) {
      if (!isValidSigningRequestId(request.id)) continue;
      try {
        const subjects = requestDiscoverySubjects(request.baseXdr, request.network);
        for (const accountId of subjects.sourceAccountIds) {
          indexPaths.push(activityPathForSubject(activityAccountPrefix(accountId), request.id));
        }
        const addresses = [...new Set([
          ...(request.discoverySignerKeys ?? subjects.directSignerKeys),
          ...(request.creatorAddress ? [request.creatorAddress] : []),
        ])].filter(isValidStellarAccountId);
        for (const address of addresses) {
          indexPaths.push(activityPathForSubject(activityAddressPrefix(address), request.id));
        }
      } catch {
        console.warn('Activity index skipped an unreadable request', { requestId: request.id });
      }
    }
    await writeIndexPaths(indexPaths);
    await withBlobStorage(async () => {
      await put(ACTIVITY_READY_PATH, JSON.stringify({ version: 1, builtAt: new Date().toISOString() }), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
    activityIndexReady = true;
  })();

  try {
    await activityIndexBuild;
  } finally {
    if (!activityIndexReady) activityIndexBuild = null;
  }
}

async function requestIdsForPrefix(prefix: string): Promise<string[]> {
  return withBlobStorage(async () => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, limit: 100, cursor });
      for (const blob of page.blobs) {
        const filename = blob.pathname.slice(prefix.length);
        if (!filename.endsWith('.json')) continue;
        const id = filename.slice(0, -'.json'.length);
        if (isValidSigningRequestId(id)) ids.push(id);
      }
      cursor = page.cursor;
    } while (cursor);
    return ids;
  });
}

async function putActivityEventRecord(id: string, event: ActivityFactEvent): Promise<void> {
  await withBlobStorage(async () => {
    const pathname = activityPath(id, event.eventId);
    if (await readJson<ActivityEvent>(pathname)) return;
    try {
      await put(pathname, JSON.stringify(event), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    } catch (cause) {
      // Deterministic event ids make concurrent identical lifecycle writes safe.
      if (await readJson<ActivityEvent>(pathname)) return;
      throw cause;
    }
  });
}

async function appendActivityBestEffort(id: string, event: ActivityFactEvent): Promise<void> {
  try {
    await putActivityEventRecord(id, event);
  } catch (cause) {
    // Request, signature, and submission records are the hard facts. Activity is
    // reconstructable and must never make one of those successful writes fail.
    console.error('Activity event write failed', { requestId: id, eventId: event.eventId, cause });
  }
}

export const blobSigningRequestStore: SigningRequestStore = {
  async createRequest(request) {
    // Candidate indexes first: a failed index write must not leave a Request
    // that was reported as created but cannot be discovered by its users.
    await writeActivityRequestIndex(request);
    await writeDiscoveryIndex(request);
    await withBlobStorage(async () => {
      await put(requestPath(request.id), JSON.stringify(request), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
    await appendActivityBestEffort(request.id, {
      version: 1,
      eventId: 'created',
      requestId: request.id,
      type: 'request_created',
      occurredAt: request.createdAt,
      ...(request.creatorAddress ? { actorAddress: request.creatorAddress } : {}),
    });
  },

  getRequest(id) {
    return readJson<StoredSigningRequest>(requestPath(id));
  },

  listRequests() {
    return listAllRequests();
  },

  async listRequestsByDiscoverySubjects(network, sourceAccountIds, directSignerKey) {
    await ensureDiscoveryIndex();
    const prefixes = [...new Set([
      ...sourceAccountIds.map((accountId) => discoveryAccountPrefix(network, accountId)),
      discoverySignerPrefix(network, directSignerKey),
    ])];
    const groups = await Promise.all(prefixes.map((prefix) => requestIdsForPrefix(prefix)));
    const ids = [...new Set(groups.flat())];
    const requests = await readJsonBatch<StoredSigningRequest>(ids.map((id) => requestPath(id)));
    return requests.filter((request) => request.network === network);
  },

  async listRequestsByActivitySubjects(network, sourceAccountIds, actorAddress) {
    await ensureActivityIndex();
    const prefixes = [...new Set([
      ...sourceAccountIds.map((accountId) => activityAccountPrefix(accountId)),
      ...(actorAddress ? [activityAddressPrefix(actorAddress)] : []),
    ])];
    const groups = await Promise.all(prefixes.map((prefix) => requestIdsForPrefix(prefix)));
    const ids = [...new Set(groups.flat())];
    const requests = await readJsonBatch<StoredSigningRequest>(ids.map((id) => requestPath(id)));
    return requests.filter((request) => request.network === network);
  },

  async listContributions(id) {
    return withBlobStorage(async () => {
      const prefix = `requests/${id}/signatures/`;
      const contributions: StoredSignatureContribution[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, limit: 100, cursor });
        contributions.push(...await readJsonBatch<StoredSignatureContribution>(page.blobs.map((blob) => blob.pathname)));
        cursor = page.cursor;
      } while (cursor);
      return contributions;
    });
  },

  async putContribution(id, contribution) {
    await withBlobStorage(async () => {
      await put(contributionPath(id, contribution.digest), JSON.stringify(contribution), {
        access: 'private',
        addRandomSuffix: false,
        // Content-addressed path: an identical contribution may safely race and
        // replace itself without mutating request meaning.
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
    const actorAddresses = [...new Set(
      (contribution.acceptedSignatures ?? [])
        .map((item) => item.signerKey)
        .filter(isValidStellarAccountId),
    )];
    try {
      await Promise.all(actorAddresses.map((address) => writeActivityParticipantIndex(id, address)));
    } catch (cause) {
      // Activity indexing is a projection. The accepted contribution above is
      // canonical and must not be reported as failed because an index update did.
      console.error('Activity participant index write failed', { requestId: id, actorAddresses, cause });
    }
    await appendActivityBestEffort(id, {
      version: 1,
      eventId: `approval-${contribution.digest}`,
      requestId: id,
      type: 'approval_added',
      occurredAt: contribution.receivedAt,
      ...(actorAddresses.length === 1 ? { actorAddress: actorAddresses[0] } : {}),
    });
  },

  getSubmission(id, transactionHash) {
    return readJson<StoredSubmissionResult>(submissionPath(id, transactionHash));
  },

  async putSubmission(id, submission) {
    await withBlobStorage(async () => {
      await put(submissionPath(id, submission.transactionHash), JSON.stringify(submission), {
        access: 'private',
        addRandomSuffix: false,
        // Submission result is verified against Horizon and keyed by the fixed
        // request transaction hash, so identical concurrent finalization is safe.
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
    await appendActivityBestEffort(id, {
      version: 1,
      eventId: `confirmed-${submission.transactionHash}`,
      requestId: id,
      type: 'transaction_confirmed',
      occurredAt: submission.submittedAt,
      ledger: submission.ledger,
    });
  },

  getRequestParticipant(id, address) {
    return readJson<StoredRequestParticipant>(participantPath(id, address));
  },

  async listRequestParticipants(id) {
    return withBlobStorage(async () => {
      const prefix = `requests/${id}/participants/`;
      const participants: StoredRequestParticipant[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, limit: 100, cursor });
        participants.push(...await readJsonBatch<StoredRequestParticipant>(page.blobs.map((blob) => blob.pathname)));
        cursor = page.cursor;
      } while (cursor);
      return participants.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.address.localeCompare(b.address));
    });
  },

  async putRequestParticipant(id, participant) {
    await withBlobStorage(async () => {
      const pathname = participantPath(id, participant.address);
      if (await readJson<StoredRequestParticipant>(pathname)) return;
      try {
        await put(pathname, JSON.stringify(participant), {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
        });
      } catch (cause) {
        if (await readJson<StoredRequestParticipant>(pathname)) return;
        throw cause;
      }
    });
    await writeActivityParticipantIndex(id, participant.address);
  },

  async listActivityEvents(id) {
    return withBlobStorage(async () => {
      const prefix = `requests/${id}/activity/`;
      const events: ActivityEvent[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, limit: 100, cursor });
        events.push(...await readJsonBatch<ActivityEvent>(page.blobs.map((blob) => blob.pathname)));
        cursor = page.cursor;
      } while (cursor);
      return events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId));
    });
  },

  putActivityEvent(id, event) {
    return putActivityEventRecord(id, event);
  },

  async listPrivateNoteRevisions(id) {
    return withBlobStorage(async () => {
      const prefix = `requests/${id}/private-note/`;
      const revisions: PrivateNoteRevision[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, limit: 100, cursor });
        revisions.push(...await readJsonBatch<PrivateNoteRevision>(page.blobs.map((blob) => blob.pathname)));
        cursor = page.cursor;
      } while (cursor);
      return revisions.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.revisionId.localeCompare(b.revisionId));
    });
  },

  async putPrivateNoteRevision(id, revision) {
    await withBlobStorage(async () => {
      await put(privateNotePath(id, revision.revisionId), JSON.stringify(revision), {
        access: 'private',
        addRandomSuffix: false,
        // Revisions are immutable audit facts; changing a note creates a new id.
        allowOverwrite: false,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    });
  },
};