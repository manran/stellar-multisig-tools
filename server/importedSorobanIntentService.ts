import {
  FeeBumpTransaction,
  Networks,
  TransactionBuilder,
} from '@stellar/stellar-sdk/base';
import { assertSorobanTransactionPreparedForFreeze, initializeSorobanGAccountAuthorizationWindow } from '../src/stellar/sorobanAuthorization.js';
import { createSorobanAuthorizationPlan } from '../src/stellar/sorobanAuthorizationPlan.js';
import { createSorobanIntent } from '../src/stellar/sorobanIntent.js';
import { initializeSorobanContractAccountAuthorizationWindow } from '../src/stellar/sorobanCustomAuthorization.js';
import type { StellarNetwork } from '../src/stellar/types.js';
import { simulateSorobanTransaction, SorobanSimulationError } from '../src/stellar/sorobanRpc.js';
import { loadAccount, loadNetworkParameters } from '../src/stellar/horizon.js';
import { discoverSorobanIntentSignerKeys } from './sorobanIntentPlanningService.js';
import {
  createStoredSorobanIntent,
  SorobanIntentServiceError,
} from './sorobanIntentService.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

type AccountLoader = typeof loadAccount;
type NetworkParametersLoader = typeof loadNetworkParameters;
type Simulator = typeof simulateSorobanTransaction;

interface ImportedSorobanIntentOptions {
  now?: Date;
  idFactory?: () => string;
  beforeCreate?: () => Promise<void>;
  accountLoader?: AccountLoader;
  networkParametersLoader?: NetworkParametersLoader;
  simulator?: Simulator;
}

function passphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

export async function createImportedSorobanIntent(
  store: SorobanIntentStore,
  creatorAddress: string,
  input: {
    network: StellarNetwork;
    preparedXdr: unknown;
    privateNote?: unknown;
    externalReference?: unknown;
  },
  options: ImportedSorobanIntentOptions = {},
): Promise<StoredSorobanIntent> {
  if (typeof input.preparedXdr !== 'string' || !input.preparedXdr.trim()) {
    throw new SorobanIntentServiceError(
      'Prepared Soroban transaction XDR is required.',
      400,
      'prepared_xdr_required',
    );
  }
  const envelopeXdr = input.preparedXdr.trim();
  let parsed;
  try {
    parsed = TransactionBuilder.fromXDR(envelopeXdr, passphrase(input.network));
  } catch {
    throw new SorobanIntentServiceError(
      'Prepared XDR is not a valid Stellar transaction for this network.',
      400,
      'invalid_prepared_xdr',
    );
  }
  if (parsed instanceof FeeBumpTransaction || parsed.operations.length !== 1) {
    throw new SorobanIntentServiceError(
      'Soroban Intent import requires one ordinary transaction with exactly one InvokeHostFunction operation.',
      400,
      'unsupported_prepared_xdr',
    );
  }
  if (parsed.signatures.length > 0) {
    throw new SorobanIntentServiceError(
      'Remove transaction-envelope signatures before importing this Soroban Intent. Intent authorization is collected before the final transaction envelope is signed.',
      409,
      'prepared_xdr_already_signed',
    );
  }
  const operation = parsed.operations[0];
  if (operation.type !== 'invokeHostFunction') {
    throw new SorobanIntentServiceError(
      'Soroban Intent import requires exactly one InvokeHostFunction operation.',
      400,
      'unsupported_prepared_xdr',
    );
  }
  try {
    assertSorobanTransactionPreparedForFreeze(envelopeXdr, input.network);
  } catch (cause) {
    throw new SorobanIntentServiceError(
      cause instanceof Error ? cause.message : 'Soroban execution resources have not been assembled yet.',
      400,
      'prepared_xdr_not_assembled',
    );
  }

  const intent = createSorobanIntent(input.network, operation.func);
  const parameters = await (options.networkParametersLoader ?? loadNetworkParameters)(input.network);
  let validatedImportXdr = envelopeXdr;
  try {
    // Validate configured contract-account evidence before record mode clears the
    // imported AUTH footprint. Pre-staged custom evidence remains fail-closed.
    validatedImportXdr = await initializeSorobanContractAccountAuthorizationWindow({
      envelopeXdr,
      network: input.network,
      currentLedger: parameters.ledgerSequence,
    });
  } catch (cause) {
    throw new SorobanIntentServiceError(
      cause instanceof Error ? cause.message : 'Unable to initialize contract-account authorization.',
      409,
      'contract_account_auth_import_unsupported',
    );
  }
  let simulation;
  try {
    simulation = await (options.simulator ?? simulateSorobanTransaction)({ envelopeXdr: validatedImportXdr, network: input.network });
  } catch (cause) {
    if (cause instanceof SorobanSimulationError) {
      throw new SorobanIntentServiceError(
        `Unable to establish a simulation-effects baseline for this imported Intent. ${cause.message}`,
        cause.kind === 'invalid' || cause.kind === 'unsupported' ? 400 : 503,
        'prepared_xdr_effects_unavailable',
      );
    }
    throw cause;
  }
  if (!simulation.assembledXdr) {
    throw new SorobanIntentServiceError(
      'Recording simulation did not produce an assembled Soroban transaction for this import.',
      503,
      'prepared_xdr_effects_unavailable',
    );
  }
  const initializedGAccountXdr = await initializeSorobanGAccountAuthorizationWindow({
    envelopeXdr: simulation.assembledXdr,
    network: input.network,
    currentLedger: simulation.latestLedger,
  });
  const initializedXdr = await initializeSorobanContractAccountAuthorizationWindow({
    envelopeXdr: initializedGAccountXdr,
    network: input.network,
    currentLedger: simulation.latestLedger,
  });
  const authorizationPlan = createSorobanAuthorizationPlan(intent, initializedXdr, simulation.effects);
  if (authorizationPlan.executionBinding !== 'detached') {
    throw new SorobanIntentServiceError(
      'This contract call uses SOURCE_ACCOUNT Soroban authorization, which binds authorization to the final transaction source. MultiSigTools Intent workflows intentionally collect authorization before choosing an executor, so this source-bound authorization cannot be used here. Use detached address authorization instead, or change the contract/integration so authorization is not supplied by the transaction source.',
      409,
      'source_account_auth_unsupported',
    );
  }

  const discoverySignerKeys = await discoverSorobanIntentSignerKeys(
    authorizationPlan,
    simulation.latestLedger,
    { accountLoader: options.accountLoader ?? loadAccount },
  );
  await options.beforeCreate?.();
  return createStoredSorobanIntent(store, {
    intent,
    authorizationPlan,
    creatorAddress,
    discoverySignerKeys,
    privateNote: input.privateNote,
    externalReference: input.externalReference,
  }, {
    now: options.now,
    idFactory: options.idFactory,
  });
}
