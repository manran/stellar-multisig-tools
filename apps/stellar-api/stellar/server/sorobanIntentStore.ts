import type { AgentActorProvenance } from '../../../../packages/stellar-core/src/agentAccessTypes.js';
import type { MachineCallerProvenance } from '../../../../packages/stellar-core/src/coordinationActorTypes.js';
import type { SorobanIntentIntegrationContext } from '../../../../packages/stellar-core/src/integrationTypes.js';
import type { SorobanExecutionPolicy } from '../../../../packages/stellar-core/src/executionPolicy.js';
import type { SorobanAuthorizationPlan } from '../../../../packages/stellar-core/src/sorobanAuthorizationPlan.js';
import type { SorobanIntent } from '../../../../packages/stellar-core/src/sorobanIntent.js';
import type { PrivateNoteRevision } from '../../../../packages/stellar-core/src/privateNote.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

export type SorobanIntentStoreConflictCode =
  | 'authorization_plan_changed'
  | 'intent_already_executed'
  | 'intent_execution_outcome_unknown';

export class SorobanIntentStoreConflictError extends Error {
  constructor(readonly code: SorobanIntentStoreConflictCode) {
    super(code);
    this.name = 'SorobanIntentStoreConflictError';
  }
}

export interface SorobanIntentPrivateContext {
  externalReference?: string;
  initialPrivateNote?: PrivateNoteRevision;
}

export interface StoredSorobanIntentAuthorizationContribution {
  version: 1;
  digest: string;
  entryIndex: number;
  signerAddress: string;
  signatureBase64: string;
  /** Plan identity is optional only for contributions written before plan revisions existed. */
  authorizationPlanDigest?: string;
  authorizationPlanRevision?: number;
  receivedAt: string;
  submittedBy?: AgentActorProvenance;
}

export interface SorobanExecutionNonInclusionProof {
  oldestLedger: number;
  latestLedger: number;
  latestLedgerClosedAt: string;
  checkedAt: string;
}

export interface StoredSorobanIntentExecutionPreparation {
  version: 1;
  transactionHash: string;
  authorizationPlanDigest: string;
  authorizationPlanRevision: number;
  executionSource: string;
  transactionSequence: string;
  validUntil: string | null;
  latestLedger: number;
  effectsDigest: string;
  effectsAccepted: boolean;
  preparedAt: string;
  preparedByAddress?: string;
  preparedBy?: MachineCallerProvenance;
  nonInclusionProof?: SorobanExecutionNonInclusionProof;
}

export interface StoredSorobanIntentExecutionObservation {
  version: 1;
  transactionHash: string;
  authorizationPlanDigest: string;
  authorizationPlanRevision: number;
  executionSource: string;
  ledger: number;
  successful: boolean;
  observedAt: string;
  networkCreatedAt?: string;
}

export interface StoredSorobanAuthorizationPlanRevision {
  revision: number;
  authorizationPlan: SorobanAuthorizationPlan;
  supersededAt: string;
}

export interface StoredSorobanIntentCancellation {
  version: 1;
  cancelledAt: string;
  authorizationPlanDigest: string;
  authorizationPlanRevision: number;
  cancelledByAddress?: string;
  cancelledBy?: MachineCallerProvenance;
}

export interface StoredSorobanIntent {
  version: 1;
  id: string;
  network: StellarNetwork;
  intent: SorobanIntent;
  authorizationPlan: SorobanAuthorizationPlan;
  /** Missing on legacy records means revision 1. */
  authorizationPlanRevision?: number;
  authorizationPlanHistory?: StoredSorobanAuthorizationPlanRevision[];
  createdAt: string;
  creatorAddress?: string;
  creatorActor?: MachineCallerProvenance;
  /** Private idempotency evidence for an accepted semantic creation input. */
  creationInputHash?: string;
  discoverySignerKeys: string[];
  integration?: SorobanIntentIntegrationContext;
  executionPolicy?: SorobanExecutionPolicy;
  privateContext?: SorobanIntentPrivateContext;
  cancellation?: StoredSorobanIntentCancellation;
}

export function publicSorobanIntent(stored: StoredSorobanIntent): Omit<StoredSorobanIntent, 'creationInputHash'> {
  const { creationInputHash: _internal, ...intent } = stored;
  return intent;
}

/** A verified successful execution is terminal for the business Intent, even
 * when the receipt belongs to an older AuthorizationPlan revision. */
export function successfulSorobanExecution(observations: readonly StoredSorobanIntentExecutionObservation[]) {
  return observations.filter((item) => item.successful)
    .sort((a, b) => a.ledger - b.ledger || a.transactionHash.localeCompare(b.transactionHash))[0];
}

export async function assertSorobanIntentNotExecuted(store: SorobanIntentStore, id: string): Promise<void> {
  if (successfulSorobanExecution(await (store.listExecutionObservations?.(id) ?? Promise.resolve([])))) {
    throw new SorobanIntentStoreConflictError('intent_already_executed');
  }
}

/** A released hash remains potentially executable until a receipt or verified
 * non-inclusion resolves it. An older authorization revision is not an exception. */
export function unresolvedSorobanPreparations(
  preparations: readonly StoredSorobanIntentExecutionPreparation[],
  observations: readonly StoredSorobanIntentExecutionObservation[],
): StoredSorobanIntentExecutionPreparation[] {
  const observed = new Set(observations.map((item) => item.transactionHash));
  const pending = new Map<string, StoredSorobanIntentExecutionPreparation>();
  for (const item of preparations) {
    if (observed.has(item.transactionHash) || item.nonInclusionProof) continue;
    const prior = pending.get(item.transactionHash);
    if (!prior || item.latestLedger < prior.latestLedger) pending.set(item.transactionHash, item);
  }
  return [...pending.values()].sort((a, b) => a.preparedAt.localeCompare(b.preparedAt));
}

export async function assertSorobanExecutionResolved(store: SorobanIntentStore, id: string): Promise<void> {
  const [preparations, observations] = await Promise.all([
    store.listExecutionPreparations?.(id) ?? Promise.resolve([]),
    store.listExecutionObservations?.(id) ?? Promise.resolve([]),
  ]);
  if (successfulSorobanExecution(observations)) throw new SorobanIntentStoreConflictError('intent_already_executed');
  if (unresolvedSorobanPreparations(preparations, observations).length) {
    throw new SorobanIntentStoreConflictError('intent_execution_outcome_unknown');
  }
}

export function assertCurrentSorobanPlan(stored: StoredSorobanIntent | null, expected: StoredSorobanIntent): void {
  if (!stored || (stored.authorizationPlanRevision ?? 1) !== (expected.authorizationPlanRevision ?? 1)
    || stored.authorizationPlan.authorizationPlanDigest !== expected.authorizationPlan.authorizationPlanDigest) {
    throw new SorobanIntentStoreConflictError('authorization_plan_changed');
  }
}

export interface SorobanIntentStore {
  createIntent(value: StoredSorobanIntent): Promise<void>;
  getIntent(id: string): Promise<StoredSorobanIntent | null>;
  updateIntent(value: StoredSorobanIntent): Promise<void>;
  cancelIntent?(id: string, cancellation: StoredSorobanIntentCancellation): Promise<{ cancellation: StoredSorobanIntentCancellation; created: boolean }>;
  bindExecutionPolicy?(id: string, executionPolicy: SorobanExecutionPolicy): Promise<SorobanExecutionPolicy>;
  listIntentsBySigner?(network: StellarNetwork, signerAddress: string, authorizerAccounts?: string[]): Promise<StoredSorobanIntent[]>;
  listIntentsByActivitySigner?(network: StellarNetwork, signerAddress: string): Promise<StoredSorobanIntent[]>;
  listContributions(id: string): Promise<StoredSorobanIntentAuthorizationContribution[]>;
  putContribution(id: string, contribution: StoredSorobanIntentAuthorizationContribution): Promise<void>;
  listExecutionPreparations?(id: string): Promise<StoredSorobanIntentExecutionPreparation[]>;
  putExecutionPreparation?(id: string, preparation: StoredSorobanIntentExecutionPreparation): Promise<void>;
  recordExecutionNonInclusion?(id: string, transactionHash: string, proof: SorobanExecutionNonInclusionProof): Promise<void>;
  listExecutionObservations?(id: string): Promise<StoredSorobanIntentExecutionObservation[]>;
  getExecutionObservation?(id: string, transactionHash: string): Promise<StoredSorobanIntentExecutionObservation | null>;
  putExecutionObservation?(id: string, observation: StoredSorobanIntentExecutionObservation): Promise<void>;
}
