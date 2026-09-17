import {
  fixedStellarDeploymentNetwork,
  parseStellarDeploymentNetwork,
} from '../../../../src/stellar/deploymentNetwork.js';
import type { StellarDeploymentNetwork } from '../../../../src/stellar/deploymentNetwork.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';

export class DeploymentNetworkPolicyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DeploymentNetworkPolicyError';
  }
}

export function configuredDeploymentNetwork(
  environment: NodeJS.ProcessEnv = process.env,
): StellarDeploymentNetwork {
  try {
    return parseStellarDeploymentNetwork(environment.VITE_STELLAR_DEPLOYMENT_NETWORK);
  } catch (cause) {
    throw new DeploymentNetworkPolicyError(
      cause instanceof Error ? cause.message : 'Invalid Stellar deployment network.',
      500,
      'invalid_deployment_network',
    );
  }
}

export function assertDeploymentNetwork(
  network: StellarNetwork,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const fixed = fixedStellarDeploymentNetwork(configuredDeploymentNetwork(environment));
  if (!fixed || fixed === network) return;
  throw new DeploymentNetworkPolicyError(
    `This endpoint is restricted to Stellar ${fixed === 'testnet' ? 'Testnet' : 'Mainnet'}.`,
    409,
    'deployment_network_mismatch',
  );
}
