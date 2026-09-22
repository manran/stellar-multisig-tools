import { StrKey, inspectAuthEntry } from '@stellar/stellar-sdk/base';
import { isValidStellarAccountId, loadAccount, loadNetworkParameters } from '../../../../packages/stellar-core/src/horizon.js';
import {
  analyzeSorobanGAccountAuthorizationEntries,
  initializeSorobanGAccountAuthorizationWindow,
} from '../../../../packages/stellar-core/src/sorobanAuthorization.js';
import {
  authorizationEntriesFromPlan,
  createSorobanAuthorizationPlan,
  type SorobanAuthorizationPlan,
} from '../../../../packages/stellar-core/src/sorobanAuthorizationPlan.js';
import { materializeSorobanIntent, type SorobanIntent } from '../../../../packages/stellar-core/src/sorobanIntent.js';
import { analyzeKnownSorobanContractAuthorizationEntries } from '../../../../packages/stellar-core/src/sorobanContractAdapter.js';
import { initializeSorobanContractAccountAuthorizationWindow } from '../../../../packages/stellar-core/src/sorobanCustomAuthorization.js';
import { simulateSorobanTransaction } from '../../../../packages/stellar-core/src/sorobanRpc.js';

export class SorobanIntentPlanningError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'SorobanIntentPlanningError';
  }
}

type AccountLoader = typeof loadAccount;
type NetworkParametersLoader = typeof loadNetworkParameters;
type Simulator = typeof simulateSorobanTransaction;

interface PlanningDependencies {
  accountLoader?: AccountLoader;
  networkParametersLoader?: NetworkParametersLoader;
  simulator?: Simulator;
}

async function planInternal(
  intent: SorobanIntent,
  planningSource: string,
  dependencies: PlanningDependencies,
): Promise<{ authorizationPlan: SorobanAuthorizationPlan; currentLedger: number }> {
  const sourceAddress = planningSource.trim();
  if (!isValidStellarAccountId(sourceAddress)) {
    throw new SorobanIntentPlanningError(
      'A valid deployment Soroban planning source is required.',
      'invalid_planning_source',
    );
  }
  const [source, parameters] = await Promise.all([
    (dependencies.accountLoader ?? loadAccount)(sourceAddress, intent.network),
    (dependencies.networkParametersLoader ?? loadNetworkParameters)(intent.network),
  ]);
  const planningTransaction = materializeSorobanIntent({
    intent,
    sourceAccount: source.accountId,
    sourceSequence: source.sequence,
    fee: String(parameters.baseFeeInStroops),
    lifetimeSeconds: 300,
  });
  const simulation = await (dependencies.simulator ?? simulateSorobanTransaction)({
    envelopeXdr: planningTransaction.toXDR(),
    network: intent.network,
  });
  if (!simulation.assembledXdr) {
    throw new SorobanIntentPlanningError(
      'Recording simulation did not produce an assembled Soroban transaction.',
      'planning_simulation_unassembled',
    );
  }
  const initializedGAccountXdr = await initializeSorobanGAccountAuthorizationWindow({
    envelopeXdr: simulation.assembledXdr,
    network: intent.network,
    currentLedger: simulation.latestLedger,
  });
  const initializedXdr = await initializeSorobanContractAccountAuthorizationWindow({
    envelopeXdr: initializedGAccountXdr,
    network: intent.network,
    currentLedger: simulation.latestLedger,
  });
  const authorizationPlan = createSorobanAuthorizationPlan(intent, initializedXdr, simulation.effects);
  if (authorizationPlan.executionBinding === 'source_bound') {
    throw new SorobanIntentPlanningError(
      'This contract call uses SOURCE_ACCOUNT Soroban authorization, which binds authorization to the final transaction source. MultiSigTools Intent workflows intentionally collect authorization before choosing an executor, so this source-bound authorization cannot be used here. Use detached address authorization instead, or change the contract/integration so authorization is not supplied by the transaction source.',
      'source_account_auth_unsupported',
    );
  }
  assertSupportedContractAuthorization(authorizationPlan, simulation.latestLedger);
  return { authorizationPlan, currentLedger: simulation.latestLedger };
}

function assertSupportedContractAuthorization(
  plan: SorobanAuthorizationPlan,
  currentLedger: number,
) {
  const authEntries = authorizationEntriesFromPlan(plan);
  const hasContractAuthorizer = authEntries.some((entry) => {
    const info = inspectAuthEntry(entry);
    return Boolean(info.address && StrKey.isValidContract(info.address));
  });
  if (!hasContractAuthorizer) return null;
  const analysis = analyzeKnownSorobanContractAuthorizationEntries({
    authEntries,
    network: plan.network,
    currentLedger,
  });
  if (!analysis.supported || !analysis.authorizer) {
    throw new SorobanIntentPlanningError(
      analysis.reason ?? 'This contract-account authorization is not supported by the configured Intent adapter.',
      'contract_account_auth_unsupported',
    );
  }
  return analysis;
}

export async function discoverSorobanIntentSignerKeys(
  plan: SorobanAuthorizationPlan,
  currentLedger: number,
  dependencies: Pick<PlanningDependencies, 'accountLoader'> = {},
): Promise<string[]> {
  const contractAnalysis = assertSupportedContractAuthorization(plan, currentLedger);
  if (contractAnalysis?.authorizer) return [contractAnalysis.authorizer.adapter.ownerAddress];
  const analysis = await analyzeSorobanGAccountAuthorizationEntries({
    authEntries: authorizationEntriesFromPlan(plan),
    network: plan.network,
    currentLedger,
    accountLoader: dependencies.accountLoader ?? loadAccount,
  });
  return [...new Set(analysis.authorizers.flatMap((authorizer) =>
    authorizer.activeSigners.map((signer) => signer.publicKey),
  ))].sort();
}

export async function planSorobanIntent(
  intent: SorobanIntent,
  planningSource: string,
  dependencies: PlanningDependencies = {},
): Promise<SorobanAuthorizationPlan> {
  return (await planInternal(intent, planningSource, dependencies)).authorizationPlan;
}

export async function planSorobanIntentForStorage(
  intent: SorobanIntent,
  planningSource: string,
  dependencies: PlanningDependencies = {},
): Promise<{ authorizationPlan: SorobanAuthorizationPlan; discoverySignerKeys: string[] }> {
  const result = await planInternal(intent, planningSource, dependencies);
  return {
    authorizationPlan: result.authorizationPlan,
    discoverySignerKeys: await discoverSorobanIntentSignerKeys(
      result.authorizationPlan,
      result.currentLedger,
      dependencies,
    ),
  };
}
