export const STELLAR_MAINNET_ORIGIN = 'https://stellar.multisig.tools';
export const STELLAR_TESTNET_ORIGIN = 'https://stellar-testnet.multisig.tools';

export function stellarWebOrigin(network: 'public' | 'testnet'): string {
  return network === 'testnet' ? STELLAR_TESTNET_ORIGIN : STELLAR_MAINNET_ORIGIN;
}

export function sorobanReviewUrl(network: 'public' | 'testnet', intentId: string): string {
  const url = new URL('/a', stellarWebOrigin(network));
  url.hash = intentId;
  return url.toString();
}
