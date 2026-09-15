import { createHash } from 'node:crypto';
import { StrKey, inspectAuthEntry, xdr } from '@stellar/stellar-sdk/base';
import type { AgentActorProvenance } from '../src/stellar/agentAccessTypes.js';
import {
  analyzeSorobanGAccountAuthorizationEntries,
  mergeSorobanGAccountSignatureEntry,
  type SorobanGAccountAuthorizerStatus,
} from '../src/stellar/sorobanAuthorization.js';
import {
  analyzeKnownSorobanContractAuthorizationEntries,
  resolveSimpleEd25519ContractAccountAdapter,
  simpleEd25519ContractCredentialContribution,
} from '../src/stellar/sorobanContractAdapter.js';
import {
  createSorobanContractAuthorizationChallengeForEntry,
  stageSorobanContractCredentialContributionEntry,
} from '../src/stellar/sorobanCustomAuthorization.js';
import { authorizationEntriesFromPlan } from '../src/stellar/sorobanAuthorizationPlan.js';
import { isValidStellarAccountId, loadAccount, loadNetworkParameters } from '../src/stellar/horizon.js';
import type { SorobanIntentStore, StoredSorobanIntentAuthorizationContribution } from './sorobanIntentStore.js';

export type SorobanIntentAuthorizationStatus =
  | 'awaiting_authorization'
  | 'authorization_ready'
  | 'expired'
  | 'blocked';

export class SorobanIntentAuthorizationServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'SorobanIntentAuthorizationServiceError';
  }
}
type AccountLoader = typeof loadAccount;
type NetworkParametersLoader = typeof loadNetworkParameters;

interface AuthorizationOptions {
  now?: Date;
  accountLoader?: AccountLoader;
  networkParametersLoader?: NetworkParametersLoader;
  contributionActor?: AgentActorProvenance;
}

export interface SorobanIntentAuthorizationSnapshot {
  id: string;
  network: 'public' | 'testnet';
  intentDigest: string;
  authorizationPlanDigest: string;
  executionBinding: 'detached' | 'source_bound';
  status: SorobanIntentAuthorizationStatus;
  statusDetail?: string;
  authorizationEntriesXdr: string[];
  contributionCount: number;
  authorizers: SorobanGAccountAuthorizerStatus[];
}

function digestContribution(
  authorizationPlanDigest: string,
  entryIndex: number,
  signerAddress: string,
  signatureBase64: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ authorizationPlanDigest, entryIndex, signerAddress, signatureBase64 }))
    .digest('hex');
}

function currentPlanRevision(stored: { authorizationPlanRevision?: number }): number {
  return stored.authorizationPlanRevision ?? 1;
}

function contributionBelongsToCurrentPlan(
  stored: { authorizationPlan: { authorizationPlanDigest: string }; authorizationPlanRevision?: number },
  contribution: StoredSorobanIntentAuthorizationContribution,
): boolean {
  if (contribution.authorizationPlanDigest !== undefined && contribution.authorizationPlanRevision !== undefined) {
    return contribution.authorizationPlanDigest === stored.authorizationPlan.authorizationPlanDigest
      && contribution.authorizationPlanRevision === currentPlanRevision(stored);
  }
  if (contribution.authorizationPlanDigest !== undefined) {
    return contribution.authorizationPlanDigest === stored.authorizationPlan.authorizationPlanDigest;
  }
  if (contribution.authorizationPlanRevision !== undefined) {
    return contribution.authorizationPlanRevision === currentPlanRevision(stored);
  }
  return currentPlanRevision(stored) === 1;
}
async function applyContributionToEntry({
  entry,
  network,
  entryIndex,
  signerAddress,
  signatureBase64,
}: {
  entry: xdr.SorobanAuthorizationEntry;
  network: 'public' | 'testnet';
  entryIndex: number;
  signerAddress: string;
  signatureBase64: string;
}): Promise<xdr.SorobanAuthorizationEntry> {
  const info = inspectAuthEntry(entry);
  const expirationLedger = info.signatureExpirationLedger ?? 0;
  if (info.address && StrKey.isValidContract(info.address)) {
    const adapter = resolveSimpleEd25519ContractAccountAdapter(network, info.address);
    if (!adapter) {
      throw new Error('This contract account has no explicitly configured authorization adapter.');
    }
    const challenge = createSorobanContractAuthorizationChallengeForEntry({
      entry,
      network,
      entryIndex,
      expirationLedger,
    });
    const contribution = simpleEd25519ContractCredentialContribution({
      challenge,
      adapter,
      signerAddress,
      signatureBase64,
    });
    return (await stageSorobanContractCredentialContributionEntry({
      entry,
      challenge,
      contribution,
    })).entry;
  }
  return mergeSorobanGAccountSignatureEntry({
    entry,
    network,
    signerPublicKey: signerAddress,
    signatureBase64,
    expirationLedger,
  });
}

async function applyContributions(
  entries: xdr.SorobanAuthorizationEntry[],
  network: 'public' | 'testnet',
  contributions: StoredSorobanIntentAuthorizationContribution[],
): Promise<xdr.SorobanAuthorizationEntry[]> {
  const working = [...entries];
  for (const contribution of [...contributions].sort(
    (a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.digest.localeCompare(b.digest),
  )) {
    const entry = working[contribution.entryIndex];
    if (!entry) throw new Error(`Stored authorization contribution targets missing entry #${contribution.entryIndex + 1}.`);
    working[contribution.entryIndex] = await applyContributionToEntry({
      entry,
      network,
      entryIndex: contribution.entryIndex,
      signerAddress: contribution.signerAddress,
      signatureBase64: contribution.signatureBase64,
    });
  }
  return working;
}

async function analyzeIntentAuthorizationEntries({
  entries,
  network,
  currentLedger,
  accountLoader,
}: {
  entries: xdr.SorobanAuthorizationEntry[];
  network: 'public' | 'testnet';
  currentLedger: number;
  accountLoader: AccountLoader;
}): Promise<{
  supported: boolean;
  ready: boolean;
  expired: boolean;
  reason?: string;
  authorizers: SorobanGAccountAuthorizerStatus[];
}> {
  const hasContractAuthorizer = entries.some((entry) => {
    const info = inspectAuthEntry(entry);
    return Boolean(info.address && StrKey.isValidContract(info.address));
  });
  if (!hasContractAuthorizer) {
    return analyzeSorobanGAccountAuthorizationEntries({
      authEntries: entries,
      network,
      currentLedger,
      accountLoader,
    });
  }

  const analysis = analyzeKnownSorobanContractAuthorizationEntries({
    authEntries: entries,
    network,
    currentLedger,
  });
  if (!analysis.supported || !analysis.authorizer) {
    return {
      supported: false,
      ready: false,
      expired: analysis.expired,
      ...(analysis.reason ? { reason: analysis.reason } : {}),
      authorizers: [],
    };
  }
  const authorizer = analysis.authorizer;
  const entryInfo = inspectAuthEntry(entries[authorizer.entryIndex]);
  const signer = { publicKey: authorizer.adapter.ownerAddress, weight: 1 };
  return {
    supported: true,
    ready: analysis.ready,
    expired: analysis.expired,
    authorizers: [{
      entryIndex: authorizer.entryIndex,
      authorizer: authorizer.authorizer,
      credentialType: entryInfo.credentialType === 'addressV2' ? 'addressV2' : 'address',
      expirationLedger: authorizer.expirationLedger,
      threshold: 1,
      signedWeight: authorizer.signed ? 1 : 0,
      signerEvidence: authorizer.signed ? [signer] : [],
      activeSigners: [signer],
      ready: analysis.ready,
    }],
  };
}

export async function getSorobanIntentAuthorization(
  store: SorobanIntentStore,
  id: string,
  options: AuthorizationOptions = {},
): Promise<SorobanIntentAuthorizationSnapshot> {
  const stored = await store.getIntent(id);
  if (!stored) throw new SorobanIntentAuthorizationServiceError('Soroban Intent not found.', 404, 'intent_not_found');
  const allContributions = await store.listContributions(id);
  const contributions = allContributions.filter((contribution) =>
    contributionBelongsToCurrentPlan(stored, contribution));
  const entries = await applyContributions(
    authorizationEntriesFromPlan(stored.authorizationPlan),
    stored.network,
    contributions,
  );
  const parameters = await (options.networkParametersLoader ?? loadNetworkParameters)(stored.network);
  const analysis = await analyzeIntentAuthorizationEntries({
    entries,
    network: stored.network,
    currentLedger: parameters.ledgerSequence,
    accountLoader: options.accountLoader ?? loadAccount,
  });
  const status: SorobanIntentAuthorizationStatus = analysis.expired
    ? 'expired'
    : !analysis.supported
      ? 'blocked'
      : analysis.ready
        ? 'authorization_ready'
        : 'awaiting_authorization';
  return {
    id: stored.id,
    network: stored.network,
    intentDigest: stored.intent.intentDigest,
    authorizationPlanDigest: stored.authorizationPlan.authorizationPlanDigest,
    executionBinding: stored.authorizationPlan.executionBinding,
    status,
    ...(analysis.reason ? { statusDetail: analysis.reason } : {}),
    authorizationEntriesXdr: entries.map((entry) => entry.toXdr('base64')),
    contributionCount: contributions.length,
    authorizers: analysis.authorizers,
  };
}

export async function contributeSorobanIntentAuthorization(
  store: SorobanIntentStore,
  id: string,
  input: { entryIndex: number; signerAddress: string; signatureBase64: string },
  options: AuthorizationOptions = {},
): Promise<{ authorization: SorobanIntentAuthorizationSnapshot; added: boolean }> {
  if (!Number.isInteger(input.entryIndex) || input.entryIndex < 0) {
    throw new SorobanIntentAuthorizationServiceError('A valid authorization entry is required.', 400, 'invalid_entry_index');
  }
  if (!isValidStellarAccountId(input.signerAddress)) {
    throw new SorobanIntentAuthorizationServiceError('A valid Stellar signer address is required.', 400, 'invalid_signer');
  }
  const before = await getSorobanIntentAuthorization(store, id, options);
  const target = before.authorizers.find((item) => item.entryIndex === input.entryIndex);
  if (target?.signerEvidence.some((signer) => signer.publicKey === input.signerAddress)) {
    return { authorization: before, added: false };
  }
  if (before.status !== 'awaiting_authorization') {
    throw new SorobanIntentAuthorizationServiceError(
      'This Soroban Intent is not accepting more authorization signatures.',
      409,
      'intent_authorization_not_open',
    );
  }
  if (!target || target.ready) {
    throw new SorobanIntentAuthorizationServiceError(
      'That Soroban authorization entry does not need another signature.',
      409,
      'authorization_not_pending',
    );
  }
  if (!target.activeSigners.some((signer) => signer.publicKey === input.signerAddress)) {
    throw new SorobanIntentAuthorizationServiceError(
      'This signer is not a current signer for that Soroban authorizer.',
      403,
      'authorization_signer_not_current',
    );
  }
  const currentEntryXdr = before.authorizationEntriesXdr[input.entryIndex];
  if (!currentEntryXdr) {
    throw new SorobanIntentAuthorizationServiceError('Authorization entry is unavailable.', 409, 'authorization_not_pending');
  }
  try {
    await applyContributionToEntry({
      entry: xdr.SorobanAuthorizationEntry.fromXdr(currentEntryXdr, 'base64'),
      network: before.network,
      entryIndex: input.entryIndex,
      signerAddress: input.signerAddress,
      signatureBase64: input.signatureBase64,
    });
  } catch (cause) {
    throw new SorobanIntentAuthorizationServiceError(
      cause instanceof Error ? cause.message : 'Unable to verify this Soroban authorization signature.',
      400,
      'invalid_authorization_signature',
    );
  }

  const stored = await store.getIntent(id);
  if (!stored || stored.authorizationPlan.authorizationPlanDigest !== before.authorizationPlanDigest) {
    throw new SorobanIntentAuthorizationServiceError(
      'The Soroban authorization plan changed while this signature was being verified. Reload the Intent before signing again.',
      409,
      'authorization_plan_changed',
    );
  }
  const revision = currentPlanRevision(stored);
  const contribution: StoredSorobanIntentAuthorizationContribution = {
    version: 1,
    digest: digestContribution(before.authorizationPlanDigest, input.entryIndex, input.signerAddress, input.signatureBase64),
    entryIndex: input.entryIndex,
    signerAddress: input.signerAddress,
    signatureBase64: input.signatureBase64,
    authorizationPlanDigest: before.authorizationPlanDigest,
    authorizationPlanRevision: revision,
    receivedAt: (options.now ?? new Date()).toISOString(),
    ...(options.contributionActor ? { submittedBy: options.contributionActor } : {}),
  };
  await store.putContribution(id, contribution);
  return { authorization: await getSorobanIntentAuthorization(store, id, options), added: true };
}
