import { isValidStellarAccountId } from '../src/stellar/horizon.js';
import type { StellarNetwork } from '../src/stellar/types.js';
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
