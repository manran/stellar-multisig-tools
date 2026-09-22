import { clientStellarDeploymentNetwork, resolveDeploymentNetwork } from '../../packages/stellar-core/src/deploymentNetwork.js';
import type { StellarNetwork } from '../../packages/stellar-core/src/types.js';

export function resolveStellarNetwork(
  explicitNetwork: string | null | undefined,
  walletNetwork: StellarNetwork | null | undefined,
): StellarNetwork {
  return resolveDeploymentNetwork(clientStellarDeploymentNetwork(), explicitNetwork, walletNetwork);
}
