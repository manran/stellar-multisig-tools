import { isValidStellarAccountId, loadAccount, loadNetworkParameters } from '../src/stellar/horizon.js';
import {
  initializeSorobanGAccountAuthorizationWindow,
} from '../src/stellar/sorobanAuthorization.js';
import {
  createSorobanAuthorizationPlan,
  type SorobanAuthorizationPlan,
} from '../src/stellar/sorobanAuthorizationPlan.js';
import { materializeSorobanIntent, type SorobanIntent } from '../src/stellar/sorobanIntent.js';
import { simulateSorobanTransaction } from '../src/stellar/sorobanRpc.js';

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
export async function planSorobanIntent(
  intent: SorobanIntent,
  planningSource: string,
  dependencies: PlanningDependencies = {},
): Promise<SorobanAuthorizationPlan> {
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
  const initializedXdr = await initializeSorobanGAccountAuthorizationWindow({
    envelopeXdr: simulation.assembledXdr,
    network: intent.network,
    currentLedger: simulation.latestLedger,
  });
  const plan = createSorobanAuthorizationPlan(intent, initializedXdr);
  if (plan.executionBinding === 'source_bound') {
    throw new SorobanIntentPlanningError(
      'This contract call uses SOURCE_ACCOUNT Soroban authorization, which binds authorization to the final transaction source. MultiSigTools Intent workflows intentionally collect authorization before choosing an executor, so this source-bound authorization cannot be used here. Use detached address authorization instead, or change the contract/integration so authorization is not supplied by the transaction source.',
      'source_account_auth_unsupported',
    );
  }
  return plan;
}
