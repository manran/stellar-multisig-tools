import { fixedStellarDeploymentNetwork } from '../../../../src/stellar/deploymentNetwork.js';
import {
  STELLAR_MAINNET_ORIGIN,
  STELLAR_TESTNET_ORIGIN,
} from '../../../../src/stellar/deploymentOrigins.js';
import { configuredDeploymentNetwork } from './deploymentNetworkPolicy.js';

export interface RequestAuthConfig {
  homeDomain: string;
  webAuthDomain: string;
  issuer: string;
}

function canonicalHumanOrigin(request: Request): string {
  const fixed = fixedStellarDeploymentNetwork(configuredDeploymentNetwork());
  if (fixed === 'testnet') return STELLAR_TESTNET_ORIGIN;
  if (fixed === 'public') return STELLAR_MAINNET_ORIGIN;
  return new URL(request.url).origin;
}

export function authConfigForRequest(request: Request): RequestAuthConfig {
  const humanOrigin = canonicalHumanOrigin(request);
  const homeDomain = (process.env.STELLAR_HOME_DOMAIN ?? 'stellar.multisig.tools').trim().toLowerCase();
  return {
    homeDomain,
    webAuthDomain: new URL(humanOrigin).host.toLowerCase(),
    issuer: `${humanOrigin}/api/auth`,
  };
}
