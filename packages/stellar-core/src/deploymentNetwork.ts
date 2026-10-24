import type { StellarNetwork } from './types.js';

declare global {
  interface ImportMeta {
    readonly env: {
      readonly VITE_STELLAR_DEPLOYMENT_NETWORK?: string;
    };
  }
}

export type StellarDeploymentNetwork = StellarNetwork | 'dual';

export function parseStellarDeploymentNetwork(value: unknown): StellarDeploymentNetwork {
  if (value === undefined || value === null || value === '') return 'public';
  if (value === 'public' || value === 'testnet' || value === 'dual') return value;
  throw new Error('VITE_STELLAR_DEPLOYMENT_NETWORK must be public, testnet, or dual.');
}

export function fixedStellarDeploymentNetwork(
  policy: StellarDeploymentNetwork,
): StellarNetwork | null {
  return policy === 'dual' ? null : policy;
}

export function resolveDeploymentNetwork(
  policy: StellarDeploymentNetwork,
  explicitNetwork: string | null | undefined,
  walletNetwork: StellarNetwork | null | undefined,
): StellarNetwork {
  const fixed = fixedStellarDeploymentNetwork(policy);
  if (fixed) return fixed;
  if (explicitNetwork === 'public' || explicitNetwork === 'testnet') return explicitNetwork;
  return walletNetwork ?? 'public';
}

export function clientStellarDeploymentNetwork(): StellarDeploymentNetwork {
  const configured = import.meta.env?.VITE_STELLAR_DEPLOYMENT_NETWORK
    ?? (typeof process === 'undefined' ? undefined : process.env.VITE_STELLAR_DEPLOYMENT_NETWORK);
  return parseStellarDeploymentNetwork(configured);
}

export function fixedClientStellarDeploymentNetwork(): StellarNetwork | null {
  return fixedStellarDeploymentNetwork(clientStellarDeploymentNetwork());
}
