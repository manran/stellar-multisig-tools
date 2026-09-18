import type { SigningRequestStore } from './requestStore.js';
import type { SorobanIntentStore } from './sorobanIntentStore.js';
import { blobSigningRequestStore } from './blobRequestStore.js';
import { blobSorobanIntentStore } from './blobSorobanIntentStore.js';
import { createPostgresSigningRequestStore } from '../db/postgresSigningRequestStore.js';
import { createPostgresSorobanIntentStore } from '../db/postgresSorobanIntentStore.js';

export type CoordinationStorageMode = 'blob' | 'postgres';

export class CoordinationStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoordinationStorageConfigurationError';
  }
}

export function coordinationStorageMode(
  value = process.env.MULTISIG_COORDINATION_STORAGE,
): CoordinationStorageMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'blob') return 'blob';
  if (normalized === 'postgres') return 'postgres';
  throw new CoordinationStorageConfigurationError(
    'MULTISIG_COORDINATION_STORAGE must be blob or postgres.',
  );
}

let postgresRequestStore: SigningRequestStore | null = null;
let postgresIntentStore: SorobanIntentStore | null = null;

export function runtimeSigningRequestStore(
  mode: CoordinationStorageMode = coordinationStorageMode(),
): SigningRequestStore {
  if (mode === 'blob') return blobSigningRequestStore;
  postgresRequestStore ??= createPostgresSigningRequestStore();
  return postgresRequestStore;
}

export function runtimeSorobanIntentStore(
  mode: CoordinationStorageMode = coordinationStorageMode(),
): SorobanIntentStore {
  if (mode === 'blob') return blobSorobanIntentStore;
  postgresIntentStore ??= createPostgresSorobanIntentStore();
  return postgresIntentStore;
}
