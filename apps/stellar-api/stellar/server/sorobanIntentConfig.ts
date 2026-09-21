import { isValidStellarAccountId } from '../../../../src/stellar/horizon.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';
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
