import type { StellarDeploymentNetwork } from './deploymentNetwork.js';

export const STELLAR_MAINNET_API_BASE = 'https://api.multisig.tools/stellar';
export const STELLAR_TESTNET_API_BASE = 'https://api-testnet.multisig.tools/stellar';
export const STELLAR_PUBLIC_DOCS_BASE = 'https://docs.multisig.tools/stellar';

export function stellarApiBaseForDeployment(network: StellarDeploymentNetwork): string {
  if (network === 'testnet') return STELLAR_TESTNET_API_BASE;
  if (network === 'public') return STELLAR_MAINNET_API_BASE;
  return '/api';
}
