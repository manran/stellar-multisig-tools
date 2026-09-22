import { fixedClientStellarDeploymentNetwork } from '../../../../packages/stellar-core/src/deploymentNetwork.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

export function explicitNetworkFromSearch(search: string): StellarNetwork | null {
  const fixed = fixedClientStellarDeploymentNetwork();
  if (fixed) return fixed;
  const value = new URLSearchParams(search).get('network');
  return value === 'public' || value === 'testnet' ? value : null;
}

export function resolveNetworklessWalletContext(
  applicationNetwork: StellarNetwork,
  explicitNetwork: StellarNetwork | null,
): StellarNetwork {
  return fixedClientStellarDeploymentNetwork() ?? explicitNetwork ?? applicationNetwork;
}
