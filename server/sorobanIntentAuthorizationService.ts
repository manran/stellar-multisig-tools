import { createHash } from 'node:crypto';
import { inspectAuthEntry, xdr } from '@stellar/stellar-sdk/base';
import type { AgentActorProvenance } from '../src/stellar/agentAccessTypes.js';
import {
  analyzeSorobanGAccountAuthorizationEntries,
  mergeSorobanGAccountSignatureEntry,
} from '../src/stellar/sorobanAuthorization.js';
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
  authorizers: Awaited<ReturnType<typeof analyzeSorobanGAccountAuthorizationEntries>>['authorizers'];
}

function digestContribution(entryIndex: number, signerAddress: string, signatureBase64: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ entryIndex, signerAddress, signatureBase64 }))
    .digest('hex');
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
    const info = inspectAuthEntry(entry);
    const expirationLedger = info.signatureExpirationLedger ?? 0;
    working[contribution.entryIndex] = await mergeSorobanGAccountSignatureEntry({
      entry,
      network,
      signerPublicKey: contribution.signerAddress,
      signatureBase64: contribution.signatureBase64,
      expirationLedger,
    });
  }
  return working;
}

export async function getSorobanIntentAuthorization(
  store: SorobanIntentStore,
  id: string,
  options: AuthorizationOptions = {},
): Promise<SorobanIntentAuthorizationSnapshot> {
  const stored = await store.getIntent(id);
  if (!stored) throw new SorobanIntentAuthorizationServiceError('Soroban Intent not found.', 404, 'intent_not_found');
  const contributions = await store.listContributions(id);
  const entries = await applyContributions(
    authorizationEntriesFromPlan(stored.authorizationPlan),
    stored.network,
    contributions,
  );
  const parameters = await (options.networkParametersLoader ?? loadNetworkParameters)(stored.network);
  const analysis = await analyzeSorobanGAccountAuthorizationEntries({
    authEntries: entries,
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
    await mergeSorobanGAccountSignatureEntry({
      entry: xdr.SorobanAuthorizationEntry.fromXdr(currentEntryXdr, 'base64'),
      network: before.network,
      signerPublicKey: input.signerAddress,
      signatureBase64: input.signatureBase64,
      expirationLedger: target.expirationLedger,
    });
  } catch (cause) {
    throw new SorobanIntentAuthorizationServiceError(
      cause instanceof Error ? cause.message : 'Unable to verify this Soroban authorization signature.',
      400,
      'invalid_authorization_signature',
    );
  }

  const contribution: StoredSorobanIntentAuthorizationContribution = {
    version: 1,
    digest: digestContribution(input.entryIndex, input.signerAddress, input.signatureBase64),
    entryIndex: input.entryIndex,
    signerAddress: input.signerAddress,
    signatureBase64: input.signatureBase64,
    receivedAt: (options.now ?? new Date()).toISOString(),
    ...(options.contributionActor ? { submittedBy: options.contributionActor } : {}),
  };
  await store.putContribution(id, contribution);
  return { authorization: await getSorobanIntentAuthorization(store, id, options), added: true };
}
