import { clientStellarDeploymentNetwork, resolveDeploymentNetwork } from './deploymentNetwork.js';
import type { StellarNetwork } from './types.js';

export function resolveStellarNetwork(
  explicitNetwork: string | null | undefined,
  walletNetwork: StellarNetwork | null | undefined,
): StellarNetwork {
  return resolveDeploymentNetwork(clientStellarDeploymentNetwork(), explicitNetwork, walletNetwork);
}
