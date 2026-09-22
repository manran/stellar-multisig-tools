const TREASURY_NAMES = [
  'Operations reserve',
  'Payroll treasury',
  'Growth treasury',
  'Protocol reserve',
  'Vendor payments',
  'Community fund',
  'Liquidity treasury',
] as const;

const PAYMENT_AMOUNTS = ['500', '1,250', '4,800', '12,500', '32,000', '85,000'] as const;
const PAYMENT_ASSETS = ['USDC', 'XLM', 'EURC', 'AQUA', 'yXLM'] as const;
const PAYMENT_DESTINATIONS = [
  'Vendor settlement',
  'Payroll batch',
  'Market maker',
  'Operations partner',
  'Infrastructure',
  'Grant recipient',
  'Treasury rebalance',
  'Service provider',
] as const;
const SIGNER_NAMES = ['Alice', 'Bob', 'Carol'] as const;
const SIGNING_PAIRS = [[0, 1], [0, 2], [1, 2]] as const;

const AMOUNT_ASSET_PAIR_COUNT = PAYMENT_AMOUNTS.length * PAYMENT_ASSETS.length;
const OTHER_SCENARIO_COUNT = TREASURY_NAMES.length * PAYMENT_DESTINATIONS.length * SIGNING_PAIRS.length;
const LAST_PAIR_SLOT = AMOUNT_ASSET_PAIR_COUNT - 1;

export const LANDING_SCENARIO_COUNT = AMOUNT_ASSET_PAIR_COUNT * OTHER_SCENARIO_COUNT;

export interface LandingDemoScenario {
  treasury: string;
  amount: string;
  asset: string;
  destination: string;
  signers: [string, string, string];
  signedIndexes: [number, number];
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function normalizedSeed(seed: number): number {
  return Math.trunc(seed) >>> 0;
}

function mixedSeed(seed: number, salt: number): number {
  let value = (normalizedSeed(seed) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function nextCoprimeStep(size: number, candidate: number): number {
  let next = candidate;
  do {
    next = (next + 1) % size || 1;
  } while (greatestCommonDivisor(next, size) !== 1);
  return next;
}

function coprimeStride(size: number, seed: number, salt: number): number {
  let candidate = mixedSeed(seed, salt) % size || 1;
  while (greatestCommonDivisor(candidate, size) !== 1) {
    candidate = (candidate + 1) % size || 1;
  }
  return candidate;
}

function componentSteps(size: number, seed: number, slotSalt: number, blockSalt: number) {
  const slotStep = coprimeStride(size, seed, slotSalt);
  let blockStep = coprimeStride(size, seed, blockSalt);
  while ((blockStep - LAST_PAIR_SLOT * slotStep) % size === 0) {
    blockStep = nextCoprimeStep(size, blockStep);
  }
  return { slotStep, blockStep };
}

function permutedIndex(position: number, size: number, seed: number, offsetSalt: number, strideSalt: number): number {
  const offset = mixedSeed(seed, offsetSalt) % size;
  const stride = coprimeStride(size, seed, strideSalt);
  return (offset + position * stride) % size;
}

function componentIndex(
  block: number,
  slot: number,
  size: number,
  seed: number,
  offsetSalt: number,
  slotSalt: number,
  blockSalt: number,
): number {
  const offset = mixedSeed(seed, offsetSalt) % size;
  const { slotStep, blockStep } = componentSteps(size, seed, slotSalt, blockSalt);
  return (offset + slot * slotStep + block * blockStep) % size;
}

function normalizedCycle(cycle: number): number {
  return ((Math.trunc(cycle) % LANDING_SCENARIO_COUNT) + LANDING_SCENARIO_COUNT)
    % LANDING_SCENARIO_COUNT;
}

export function landingDemoScenarioForCycle(cycle: number, seed = 0): LandingDemoScenario {
  const cycleIndex = normalizedCycle(cycle);
  const seedValue = normalizedSeed(seed);
  const block = Math.floor(cycleIndex / AMOUNT_ASSET_PAIR_COUNT);
  const slot = cycleIndex % AMOUNT_ASSET_PAIR_COUNT;
  const assetBand = Math.floor(slot / PAYMENT_AMOUNTS.length);
  const amountPositionInBand = slot % PAYMENT_AMOUNTS.length;

  // The same seeded 30-slot Latin-style order is reused in every block.
  // It contains every amount x asset pair exactly once and changes both
  // dimensions on every adjacent slot, including the 29 -> 0 boundary.
  const amountPosition = (
    amountPositionInBand
    + mixedSeed(seedValue, 0x36c4d5e6) % PAYMENT_AMOUNTS.length
  ) % PAYMENT_AMOUNTS.length;
  const assetPosition = (
    assetBand
    + amountPositionInBand
    + mixedSeed(seedValue, 0x47d5e6f7) % PAYMENT_ASSETS.length
  ) % PAYMENT_ASSETS.length;

  const amountIndex = permutedIndex(amountPosition, PAYMENT_AMOUNTS.length, seedValue, 0x58e6f708, 0x69f70819);
  const assetIndex = permutedIndex(assetPosition, PAYMENT_ASSETS.length, seedValue, 0x7a08192a, 0x8b192a3b);

  // Treasury, destination, and signing pair each vary by both slot and block.
  // For a fixed amount/asset pair, the block steps are coprime to 7, 8, and
  // 3 respectively, so the 168 blocks enumerate the full 7 x 8 x 3 product.
  // Slot steps are also coprime and are chosen so block boundaries cannot
  // repeat a component. This removes long visually static projections while
  // preserving all 5,040 complete scenarios exactly once.
  const treasuryIndex = componentIndex(block, slot, TREASURY_NAMES.length, seedValue, 0x9c2a3b4c, 0xad3b4c5d, 0xbe4c5d6e);
  const destinationIndex = componentIndex(block, slot, PAYMENT_DESTINATIONS.length, seedValue, 0xcf5d6e7f, 0xd06e7f80, 0xe17f8091);
  const signingPairIndex = componentIndex(block, slot, SIGNING_PAIRS.length, seedValue, 0xf28091a2, 0x0391a2b3, 0x14a2b3c4);
  const signingPair = SIGNING_PAIRS[signingPairIndex];

  return {
    treasury: TREASURY_NAMES[treasuryIndex],
    amount: PAYMENT_AMOUNTS[amountIndex],
    asset: PAYMENT_ASSETS[assetIndex],
    destination: PAYMENT_DESTINATIONS[destinationIndex],
    signers: [...SIGNER_NAMES],
    signedIndexes: [signingPair[0], signingPair[1]],
  };
}
