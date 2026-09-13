import { createHash } from 'node:crypto';
import { isValidStellarAccountId, loadAccount, loadNetworkParameters } from '../src/stellar/horizon.js';
import type { StellarNetworkParameters } from '../src/stellar/horizon.js';
import {
  analyzeSorobanGAccountAuthorization,
  assertSorobanTransactionPreparedForFreeze,
  initializeSorobanGAccountAuthorizationWindow,
  mergeSorobanGAccountSignature,
} from '../src/stellar/sorobanAuthorization.js';
import type { SorobanAccountLoader } from '../src/stellar/sorobanAuthorization.js';
import type {
  InboxSorobanPreparationSnapshot,
  SorobanPreparationSnapshot,
  SorobanPreparationViewerAction,
} from '../src/stellar/sorobanPreparationTypes.js';
import { inspectTransactionXdr } from '../src/stellar/transactionXdr.js';
import type { AgentActorProvenance } from '../src/stellar/agentAccessTypes.js';
import type { StellarNetwork } from '../src/stellar/types.js';
import { prepareEnforcedSorobanTransaction, SorobanSimulationError } from '../src/stellar/sorobanRpc.js';
import { requestDiscoverySignerKeys, requestDiscoverySubjectsForInspection } from './requestDiscovery.js';
import { createSigningRequest, getSigningRequest } from './requestService.js';
import type { SorobanExecutionVerifier } from './requestService.js';
import type { SigningRequestStore } from './requestStore.js';
import { createSigningRequestId, isValidSigningRequestId } from './requestLocator.js';
import type {
  SorobanPreparationStore,
  StoredSorobanAuthorizationContribution,
  StoredSorobanPreparation,
} from './sorobanPreparationStore.js';

const PREPARATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_XDR_CHARS = 256 * 1024;

export class SorobanPreparationServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'SorobanPreparationServiceError';
  }
}

type NetworkParametersLoader = (network: StellarNetwork) => Promise<StellarNetworkParameters>;
interface ServiceOptions {
  now?: Date;
  accountLoader?: SorobanAccountLoader;
  networkParametersLoader?: NetworkParametersLoader;
}

interface CreateOptions extends ServiceOptions {
  idFactory?: () => string;
  capabilityHash: string;
  creatorAddress: string;
  creatorActor?: AgentActorProvenance;
  beforeCreate?: () => Promise<void>;
  onCreateAttempt?: () => void;
}

interface ContributeOptions extends ServiceOptions {
  contributionActor?: AgentActorProvenance;
}

interface FreezeOptions extends ServiceOptions {
  actorAddress: string;
  actor?: AgentActorProvenance;
  sorobanExecutionVerifier: SorobanExecutionVerifier;
  sorobanTransactionPreparer: typeof prepareEnforcedSorobanTransaction;
}

function validateNetwork(value: unknown): StellarNetwork {
  if (value === 'public' || value === 'testnet') return value;
  throw new SorobanPreparationServiceError('Network must be public or testnet.', 400, 'invalid_network');
}

function normalizeXdr(value: string): string {
  const xdr = value.trim();
  if (!xdr) throw new SorobanPreparationServiceError('Prepared Soroban transaction XDR is required.', 400, 'invalid_xdr');
  if (xdr.length > MAX_XDR_CHARS) throw new SorobanPreparationServiceError('Prepared Soroban transaction XDR is too large.', 413, 'xdr_too_large');
  return xdr;
}

function expiryForXdr(xdr: string, network: StellarNetwork, now: Date): string {
  const inspection = inspectTransactionXdr(xdr, network);
  let expiresAt = now.getTime() + PREPARATION_TTL_MS;
  const maxTime = inspection.timeBounds?.maxTime;
  if (maxTime && maxTime !== '0') {
    const txExpiry = Number(maxTime) * 1000;
    if (Number.isFinite(txExpiry)) expiresAt = Math.min(expiresAt, txExpiry);
  }
  if (expiresAt <= now.getTime()) {
    throw new SorobanPreparationServiceError('This transaction has already expired.', 410, 'preparation_expired');
  }
  return new Date(expiresAt).toISOString();
}

function contributionDigest(entryIndex: number, signerAddress: string, signatureBase64: string): string {
  return createHash('sha256').update(`${entryIndex}:${signerAddress}:${signatureBase64}`).digest('hex');
}

async function transactionSignerKeys(
  xdr: string,
  network: StellarNetwork,
  accountLoader: SorobanAccountLoader,
): Promise<string[]> {
  const inspection = inspectTransactionXdr(xdr, network);
  const subjects = requestDiscoverySubjectsForInspection(inspection);
  const accounts = await Promise.all(subjects.sourceAccountIds.map((accountId) => accountLoader(accountId, network)));
  return requestDiscoverySignerKeys(accounts, subjects.directSignerKeys);
}

async function replayContributions(
  preparation: StoredSorobanPreparation,
  contributions: readonly StoredSorobanAuthorizationContribution[],
): Promise<string> {
  let xdr = preparation.baseXdr;
  const ordered = [...contributions].sort((left, right) =>
    left.entryIndex - right.entryIndex
    || left.signerAddress.localeCompare(right.signerAddress)
    || left.digest.localeCompare(right.digest),
  );
  for (const contribution of ordered) {
    const parsed = inspectTransactionXdr(xdr, preparation.network);
    const auth = parsed.operations[0]?.soroban?.authorizationEntries.find((entry) => entry.index === contribution.entryIndex);
    const expirationLedger = auth?.signatureExpirationLedger ?? 0;
    xdr = await mergeSorobanGAccountSignature({
      envelopeXdr: xdr,
      network: preparation.network,
      entryIndex: contribution.entryIndex,
      signerPublicKey: contribution.signerAddress,
      signatureBase64: contribution.signatureBase64,
      expirationLedger,
    });
  }
  return xdr;
}

async function buildSnapshot(
  store: SorobanPreparationStore,
  preparation: StoredSorobanPreparation,
  options: ServiceOptions = {},
  suppliedContributions?: readonly StoredSorobanAuthorizationContribution[],
): Promise<SorobanPreparationSnapshot> {
  const now = options.now ?? new Date();
  const accountLoader = options.accountLoader ?? loadAccount;
  const networkParametersLoader = options.networkParametersLoader ?? loadNetworkParameters;
  const contributions = suppliedContributions ?? await store.listContributions(preparation.id);
  const freeze = await store.getFreeze(preparation.id);
  const preparedXdr = await replayContributions(preparation, contributions);
  const inspection = inspectTransactionXdr(preparedXdr, preparation.network);
  const txSignerKeys = await transactionSignerKeys(preparedXdr, preparation.network, accountLoader);

  if (freeze) {
    return {
      id: preparation.id,
      network: preparation.network,
      preparedXdr,
      createdAt: preparation.createdAt,
      expiresAt: preparation.expiresAt,
      transactionSourceAccount: inspection.transactionSourceAccount,
      transactionSignerKeys: txSignerKeys,
      contributionCount: contributions.length,
      status: 'frozen',
      authorizers: [],
      proposalId: freeze.proposalId,
      statusDetail: 'Contract authorization is frozen into the immutable Proposal.',
    };
  }

  let currentLedger: number;
  try {
    currentLedger = (await networkParametersLoader(preparation.network)).ledgerSequence;
  } catch (cause) {
    throw new SorobanPreparationServiceError(
      cause instanceof Error ? `Unable to load current Stellar ledger state: ${cause.message}` : 'Unable to load current Stellar ledger state.',
      503,
      'policy_unavailable',
    );
  }
  const analysis = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: preparedXdr,
    network: preparation.network,
    currentLedger,
    accountLoader,
  });
  const common = {
    id: preparation.id,
    network: preparation.network,
    preparedXdr,
    createdAt: preparation.createdAt,
    expiresAt: preparation.expiresAt,
    transactionSourceAccount: inspection.transactionSourceAccount,
    transactionSignerKeys: txSignerKeys,
    contributionCount: contributions.length,
    authorizers: analysis.authorizers,
  };
  if (Date.parse(preparation.expiresAt) <= now.getTime() || analysis.expired) {
    return { ...common, status: 'expired', statusDetail: 'This contract authorization signing window has expired. Prepare a fresh authorization window to continue this request.' };
  }
  if (!analysis.supported) {
    return { ...common, status: 'blocked', statusDetail: analysis.reason ?? 'This contract authorization can no longer be verified.' };
  }
  if (analysis.ready) {
    return { ...common, status: 'ready_to_freeze', statusDetail: 'Contract authorization is complete. A transaction signer can freeze the exact prepared XDR into a Proposal.' };
  }
  return { ...common, status: 'awaiting_authorization', statusDetail: 'Waiting for additional contract authorization signatures.' };
}

export function preparationViewerAction(address: string, snapshot: SorobanPreparationSnapshot): SorobanPreparationViewerAction {
  if (snapshot.status === 'ready_to_freeze' && snapshot.transactionSignerKeys.includes(address)) return 'freeze';
  if (snapshot.status !== 'awaiting_authorization') return 'waiting';
  const canAuthorize = snapshot.authorizers.some((authorizer) =>
    !authorizer.ready
    && authorizer.activeSigners.some((signer) => signer.publicKey === address)
    && !authorizer.signerEvidence.some((signer) => signer.publicKey === address),
  );
  return canAuthorize ? 'authorize' : 'waiting';
}

export async function createSorobanPreparation(
  store: SorobanPreparationStore,
  input: { network: unknown; xdr: string },
  options: CreateOptions,
): Promise<SorobanPreparationSnapshot> {
  const network = validateNetwork(input.network);
  const suppliedXdr = normalizeXdr(input.xdr);
  const accountLoader = options.accountLoader ?? loadAccount;
  const networkParametersLoader = options.networkParametersLoader ?? loadNetworkParameters;
  if (!isValidStellarAccountId(options.creatorAddress)) {
    throw new SorobanPreparationServiceError('A verified Stellar creator is required.', 401, 'preparation_creator_required');
  }
  try {
    assertSorobanTransactionPreparedForFreeze(suppliedXdr, network);
  } catch (cause) {
    throw new SorobanPreparationServiceError(cause instanceof Error ? cause.message : 'Soroban transaction is not prepared.', 400, 'preparation_not_ready');
  }
  const inspection = inspectTransactionXdr(suppliedXdr, network);
  if (inspection.innerSignatureCount > 0 || inspection.outerSignatureCount > 0) {
    throw new SorobanPreparationServiceError('Contract authorization collaboration must finish before transaction-envelope signing begins.', 409, 'envelope_signing_started');
  }
  const currentLedger = (await networkParametersLoader(network)).ledgerSequence;
  const baseXdr = await initializeSorobanGAccountAuthorizationWindow({
    envelopeXdr: suppliedXdr,
    network,
    currentLedger,
  });
  const analysis = await analyzeSorobanGAccountAuthorization({ envelopeXdr: baseXdr, network, currentLedger, accountLoader });
  if (!analysis.supported) {
    throw new SorobanPreparationServiceError(analysis.reason ?? 'This Soroban authorization shape cannot use shared authorization.', 400, 'unsupported_authorization');
  }
  if (analysis.authorizers.length === 0) {
    throw new SorobanPreparationServiceError('This contract call has no detached G-account authorization to collaborate on.', 409, 'no_detached_authorization');
  }
  const txSignerKeys = await transactionSignerKeys(baseXdr, network, accountLoader);
  const authSignerKeys = analysis.authorizers.flatMap((authorizer) => authorizer.activeSigners.map((signer) => signer.publicKey));
  const discoverySignerKeys = [...new Set([...txSignerKeys, ...authSignerKeys])].sort();
  if (!discoverySignerKeys.includes(options.creatorAddress)) {
    throw new SorobanPreparationServiceError('The confirmed wallet is not a current signer for this transaction or its contract authorization.', 403, 'preparation_creator_not_signer');
  }
  if (!/^[0-9a-f]{64}$/i.test(options.capabilityHash)) {
    throw new SorobanPreparationServiceError('Preparation capability hash is invalid.', 500, 'invalid_capability_hash');
  }
  const now = options.now ?? new Date();
  const id = options.idFactory?.() ?? createSigningRequestId();
  if (!isValidSigningRequestId(id)) throw new SorobanPreparationServiceError('Invalid preparation request id.', 500, 'invalid_request_id');
  await options.beforeCreate?.();
  const preparation: StoredSorobanPreparation = {
    version: 1,
    id,
    network,
    baseXdr,
    createdAt: now.toISOString(),
    expiresAt: expiryForXdr(baseXdr, network, now),
    capabilityHash: options.capabilityHash,
    creatorAddress: options.creatorAddress,
    ...(options.creatorActor ? { creatorActor: options.creatorActor } : {}),
    discoverySignerKeys,
  };
  options.onCreateAttempt?.();
  await store.createPreparation(preparation);
  return buildSnapshot(store, preparation, options, []);
}

export async function getSorobanPreparation(
  store: SorobanPreparationStore,
  id: string,
  options: ServiceOptions = {},
): Promise<SorobanPreparationSnapshot> {
  if (!isValidSigningRequestId(id)) throw new SorobanPreparationServiceError('Invalid authorization request id.', 400, 'invalid_request_id');
  const preparation = await store.getPreparation(id);
  if (!preparation) throw new SorobanPreparationServiceError('Authorization request not found.', 404, 'preparation_not_found');
  return buildSnapshot(store, preparation, options);
}

export async function refreshSorobanPreparationAuthorizationWindow(
  store: SorobanPreparationStore,
  id: string,
  options: ServiceOptions = {},
): Promise<SorobanPreparationSnapshot> {
  const preparation = await store.getPreparation(id);
  if (!preparation) throw new SorobanPreparationServiceError('Authorization request not found.', 404, 'preparation_not_found');
  if (await store.getFreeze(id)) {
    throw new SorobanPreparationServiceError('Frozen authorization cannot be refreshed.', 409, 'preparation_frozen');
  }
  const contributions = await store.listContributions(id);
  if (contributions.length > 0) {
    throw new SorobanPreparationServiceError('An authorization window with existing signatures cannot be refreshed. Start a fresh authorization window.', 409, 'authorization_already_started');
  }
  const currentLedger = (await (options.networkParametersLoader ?? loadNetworkParameters)(preparation.network)).ledgerSequence;
  const refreshedXdr = await initializeSorobanGAccountAuthorizationWindow({
    envelopeXdr: preparation.baseXdr,
    network: preparation.network,
    currentLedger,
  });
  const now = options.now ?? new Date();
  const refreshed = {
    ...preparation,
    baseXdr: refreshedXdr,
    expiresAt: expiryForXdr(refreshedXdr, preparation.network, now),
  };
  await store.updatePreparation(refreshed);
  return buildSnapshot(store, refreshed, options, []);
}

export async function contributeSorobanPreparation(
  store: SorobanPreparationStore,
  id: string,
  input: { entryIndex: number; signerAddress: string; signatureBase64: string },
  options: ContributeOptions = {},
): Promise<{ preparation: SorobanPreparationSnapshot; added: boolean }> {
  const preparation = await store.getPreparation(id);
  if (!preparation) throw new SorobanPreparationServiceError('Authorization request not found.', 404, 'preparation_not_found');
  const snapshot = await buildSnapshot(store, preparation, options);
  if (snapshot.status !== 'awaiting_authorization') {
    throw new SorobanPreparationServiceError('This authorization request is not accepting more signatures.', 409, 'preparation_not_open');
  }
  if (!Number.isInteger(input.entryIndex) || input.entryIndex < 0) {
    throw new SorobanPreparationServiceError('A valid authorization entry is required.', 400, 'invalid_entry_index');
  }
  if (!isValidStellarAccountId(input.signerAddress)) {
    throw new SorobanPreparationServiceError('A valid Stellar signer address is required.', 400, 'invalid_signer');
  }
  const target = snapshot.authorizers.find((authorizer) => authorizer.entryIndex === input.entryIndex);
  if (!target || target.ready) {
    throw new SorobanPreparationServiceError('That contract authorization entry does not need another signature.', 409, 'authorization_not_pending');
  }
  if (!target.activeSigners.some((signer) => signer.publicKey === input.signerAddress)) {
    throw new SorobanPreparationServiceError('This wallet is not a current signer for that contract authorization account.', 403, 'authorization_signer_not_current');
  }
  if (target.signerEvidence.some((signer) => signer.publicKey === input.signerAddress)) {
    return { preparation: snapshot, added: false };
  }
  let mergedXdr: string;
  try {
    mergedXdr = await mergeSorobanGAccountSignature({
      envelopeXdr: snapshot.preparedXdr,
      network: preparation.network,
      entryIndex: input.entryIndex,
      signerPublicKey: input.signerAddress,
      signatureBase64: input.signatureBase64,
      expirationLedger: target.expirationLedger,
    });
  } catch (cause) {
    throw new SorobanPreparationServiceError(cause instanceof Error ? cause.message : 'Unable to verify this contract authorization signature.', 400, 'invalid_authorization_signature');
  }
  if (mergedXdr === snapshot.preparedXdr) return { preparation: snapshot, added: false };
  const contribution: StoredSorobanAuthorizationContribution = {
    version: 1,
    digest: contributionDigest(input.entryIndex, input.signerAddress, input.signatureBase64),
    entryIndex: input.entryIndex,
    signerAddress: input.signerAddress,
    signatureBase64: input.signatureBase64,
    receivedAt: (options.now ?? new Date()).toISOString(),
    ...(options.contributionActor ? { submittedBy: options.contributionActor } : {}),
  };
  await store.putContribution(id, contribution);
  const existing = await store.listContributions(id);
  const combined = existing.some((item) => item.digest === contribution.digest) ? existing : [...existing, contribution];
  return { preparation: await buildSnapshot(store, preparation, options, combined), added: true };
}

export async function freezeSorobanPreparation(
  preparationStore: SorobanPreparationStore,
  signingStore: SigningRequestStore,
  id: string,
  options: FreezeOptions,
) {
  const preparation = await preparationStore.getPreparation(id);
  if (!preparation) throw new SorobanPreparationServiceError('Authorization request not found.', 404, 'preparation_not_found');
  const existingProposal = await signingStore.getRequest(id);
  if (existingProposal) {
    const proposal = await getSigningRequest(signingStore, id, options);
    await preparationStore.putFreeze(id, { version: 1, proposalId: id, frozenAt: proposal.createdAt, frozenBy: options.actorAddress });
    return proposal;
  }
  const snapshot = await buildSnapshot(preparationStore, preparation, options);
  if (snapshot.status !== 'ready_to_freeze') {
    throw new SorobanPreparationServiceError('Contract authorization is not complete yet.', 409, 'authorization_incomplete');
  }
  if (!snapshot.transactionSignerKeys.includes(options.actorAddress)) {
    throw new SorobanPreparationServiceError('Choose a current transaction signer before creating the Proposal.', 403, 'transaction_signer_required');
  }
  let enforcedXdr: string;
  try {
    const enforced = await options.sorobanTransactionPreparer({
      envelopeXdr: snapshot.preparedXdr,
      network: preparation.network,
    });
    enforcedXdr = enforced.assembledXdr;
  } catch (cause) {
    if (!(cause instanceof SorobanSimulationError)) throw cause;
    const invalid = cause.kind === 'invalid' || cause.kind === 'unsupported';
    throw new SorobanPreparationServiceError(
      cause.message,
      invalid ? 400 : 503,
      invalid ? 'soroban_execution_failed' : 'soroban_execution_verification_unavailable',
    );
  }
  const creatorStore: SigningRequestStore = {
    ...signingStore,
    createRequest: (request) => signingStore.createRequest({
      ...request,
      creatorAddress: options.actorAddress,
      ...(options.actor ? { creatorActor: options.actor } : {}),
    }),
  };
  const proposal = await createSigningRequest(
    creatorStore,
    { network: preparation.network, xdr: enforcedXdr },
    {
      now: options.now,
      accountLoader: options.accountLoader,
      networkParametersLoader: options.networkParametersLoader,
      sorobanExecutionVerifier: options.sorobanExecutionVerifier,
      capabilityHash: preparation.capabilityHash,
      idFactory: () => preparation.id,
    },
  );
  await preparationStore.putFreeze(id, {
    version: 1,
    proposalId: proposal.id,
    frozenAt: proposal.createdAt,
    frozenBy: options.actorAddress,
  });
  return proposal;
}

export async function listSorobanPreparationInbox(
  store: SorobanPreparationStore,
  address: string,
  network: StellarNetwork,
  options: ServiceOptions = {},
): Promise<InboxSorobanPreparationSnapshot[]> {
  if (!store.listPreparationsBySigner) return [];
  const records = await store.listPreparationsBySigner(network, address);
  const snapshots = await Promise.all(records.map(async (record) => {
    try { return await buildSnapshot(store, record, options); } catch { return null; }
  }));
  return snapshots
    .filter((snapshot): snapshot is SorobanPreparationSnapshot => Boolean(snapshot))
    .filter((snapshot) => snapshot.status === 'awaiting_authorization' || snapshot.status === 'ready_to_freeze')
    .filter((snapshot) => snapshot.transactionSignerKeys.includes(address)
      || snapshot.authorizers.some((authorizer) => authorizer.activeSigners.some((signer) => signer.publicKey === address)))
    .map((snapshot) => ({ ...snapshot, viewerAction: preparationViewerAction(address, snapshot) }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
