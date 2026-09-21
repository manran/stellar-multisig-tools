export class CoordinationWriteFrozenError extends Error {
  readonly status = 503;
  readonly code = 'coordination_write_frozen';

  constructor() {
    super('MultiSigTools coordination writes are temporarily paused for a storage migration. Read and Activity access remain available.');
    this.name = 'CoordinationWriteFrozenError';
  }
}

export function assertCoordinationWritesEnabled(
  value = process.env.MULTISIG_COORDINATION_WRITE_FREEZE,
): void {
  if (value?.trim() === '1') throw new CoordinationWriteFrozenError();
}
