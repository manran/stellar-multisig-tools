import { isValidStellarAccountId } from '../../../../packages/stellar-core/src/horizon.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import type { SorobanExecutionPolicy } from '../../../../packages/stellar-core/src/executionPolicy.js';
import { SorobanIntentPlanningError } from './sorobanIntentPlanningService.js';

function environmentName(network: StellarNetwork): string {
  return network === 'testnet'
    ? 'STELLAR_SOROBAN_PLANNING_SOURCE_TESTNET'
    : 'STELLAR_SOROBAN_PLANNING_SOURCE_PUBLIC';
}

export function configuredSorobanPlanningSource(network: StellarNetwork): string {
  const name = environmentName(network);
  const value = process.env[name]?.trim() ?? '';
  if (!isValidStellarAccountId(value)) {
    throw new SorobanIntentPlanningError(
      `Deployment Soroban planning source is not configured for ${network}.`,
      'planning_source_not_configured',
    );
  }
  return value;
}

function managedExecutorEnvironmentName(network: StellarNetwork): string {
  return network === 'testnet'
    ? 'STELLAR_SOROBAN_MANAGED_EXECUTOR_TESTNET'
    : 'STELLAR_SOROBAN_MANAGED_EXECUTOR_PUBLIC';
}

export function integrationSorobanExecutionAvailable(
  network: StellarNetwork,
  policy: SorobanExecutionPolicy | undefined,
  allowedExecutors: readonly string[],
  managedExecutor?: string | null,
): boolean {
  if (policy?.executor && policy.executor.source !== 'multisigtools_managed') {
    return allowedExecutors.includes(policy.executor.address);
  }
  if (policy?.mode !== 'multisigtools' && allowedExecutors.length > 0) return true;
  const managed = managedExecutor === undefined ? configuredSorobanManagedExecutor(network) : managedExecutor;
  return Boolean(managed && (!policy?.executor || policy.executor.address === managed));
}

export function configuredSorobanManagedExecutor(network: StellarNetwork): string | null {
  const name = managedExecutorEnvironmentName(network);
  const value = process.env[name]?.trim() ?? '';
  if (!value) return null;
  if (!isValidStellarAccountId(value)) {
    throw new SorobanIntentPlanningError(
      `Deployment Soroban managed executor is invalid for ${network}.`,
      'managed_executor_config_invalid',
    );
  }
  return value;
}
