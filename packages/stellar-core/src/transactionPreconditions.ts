import type { StellarNetworkParameters } from './horizon.js';
import type { TransactionXdrInspection } from './transactionXdr.js';
import type { StellarAccountSnapshot } from './types.js';

export type TransactionPreconditionOverallStatus =
  | 'ready'
  | 'not_yet_valid'
  | 'stale'
  | 'expired'
  | 'unknown';

export type TransactionPreconditionCheckStatus = 'pass' | 'wait' | 'fail' | 'unknown';

export interface TransactionPreconditionCheck {
  code: 'sequence' | 'time_bounds' | 'ledger_bounds' | 'min_sequence_age' | 'min_sequence_ledger_gap';
  status: TransactionPreconditionCheckStatus;
  detail: string;
  failureKind?: 'stale' | 'expired';
}

export interface TransactionPreconditionAssessment {
  status: TransactionPreconditionOverallStatus;
  readyForSubmit: boolean;
  checks: TransactionPreconditionCheck[];
}

function parseBigInt(value: string, label: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function dateSeconds(value: string | Date): bigint | null {
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  return BigInt(Math.floor(millis / 1000));
}

function referenceTimeSeconds(parameters: StellarNetworkParameters | null): bigint | null {
  return parameters ? dateSeconds(parameters.ledgerClosedAt) : null;
}

function sequenceCheck(
  inspection: TransactionXdrInspection,
  source: StellarAccountSnapshot,
): TransactionPreconditionCheck {
  let transactionSequence: bigint;
  let currentSequence: bigint;
  try {
    transactionSequence = parseBigInt(inspection.sequence, 'transaction sequence');
    currentSequence = parseBigInt(source.sequence, 'account sequence');
  } catch (cause) {
    return {
      code: 'sequence',
      status: 'unknown',
      detail: cause instanceof Error ? cause.message : 'Unable to compare transaction sequence.',
    };
  }

  if (inspection.minAccountSequence !== undefined) {
    let minimumSequence: bigint;
    try {
      minimumSequence = parseBigInt(inspection.minAccountSequence, 'minimum account sequence');
    } catch (cause) {
      return {
        code: 'sequence',
        status: 'unknown',
        detail: cause instanceof Error ? cause.message : 'Unable to parse minimum account sequence.',
      };
    }

    if (currentSequence >= transactionSequence) {
      return {
        code: 'sequence',
        status: 'fail',
        failureKind: 'stale',
        detail: `Transaction sequence ${transactionSequence} has already been reached or consumed; the source account is at ${currentSequence}.`,
      };
    }
    if (currentSequence < minimumSequence) {
      return {
        code: 'sequence',
        status: 'wait',
        detail: `Source sequence ${currentSequence} has not reached the transaction minimum ${minimumSequence}.`,
      };
    }
    return {
      code: 'sequence',
      status: 'pass',
      detail: `Relaxed sequence precondition is satisfied: ${minimumSequence} <= ${currentSequence} < ${transactionSequence}.`,
    };
  }

  const expected = currentSequence + 1n;
  if (transactionSequence === expected) {
    return {
      code: 'sequence',
      status: 'pass',
      detail: `Transaction sequence ${transactionSequence} is the source account's next sequence.`,
    };
  }
  if (transactionSequence <= currentSequence) {
    return {
      code: 'sequence',
      status: 'fail',
      failureKind: 'stale',
      detail: `Transaction sequence ${transactionSequence} has already been consumed; the source account is at ${currentSequence}.`,
    };
  }
  return {
    code: 'sequence',
    status: 'wait',
    detail: `Transaction sequence ${transactionSequence} is ahead of the directly executable sequence ${expected}. A lower-sequence transaction must execute first.`,
  };
}

function timeBoundsCheck(
  inspection: TransactionXdrInspection,
  parameters: StellarNetworkParameters | null,
): TransactionPreconditionCheck | null {
  if (!inspection.timeBounds) return null;

  let minTime: bigint;
  let maxTime: bigint;
  try {
    minTime = parseBigInt(inspection.timeBounds.minTime, 'minimum time');
    maxTime = parseBigInt(inspection.timeBounds.maxTime, 'maximum time');
  } catch (cause) {
    return {
      code: 'time_bounds',
      status: 'unknown',
      detail: cause instanceof Error ? cause.message : 'Unable to parse transaction time bounds.',
    };
  }

  if (minTime === 0n && maxTime === 0n) {
    return {
      code: 'time_bounds',
      status: 'pass',
      detail: 'Transaction has no effective time bound.',
    };
  }

  const ledgerTime = referenceTimeSeconds(parameters);
  if (ledgerTime === null) {
    return { code: 'time_bounds', status: 'unknown', detail: 'Latest ledger close time is unavailable.' };
  }

  if (maxTime !== 0n && ledgerTime >= maxTime) {
    return {
      code: 'time_bounds',
      status: 'fail',
      failureKind: 'expired',
      detail: `The latest closed ledger is already at or beyond maxTime ${maxTime}; no later ledger can satisfy this time bound.`,
    };
  }
  if (ledgerTime < minTime) {
    return {
      code: 'time_bounds',
      status: 'wait',
      detail: `Ledger time ${ledgerTime} has not reached minTime ${minTime}.`,
    };
  }
  return {
    code: 'time_bounds',
    status: 'pass',
    detail: maxTime === 0n
      ? `Ledger time ${ledgerTime} satisfies minTime ${minTime}; no maxTime is set.`
      : `Ledger time ${ledgerTime} is within the transaction time window ending at ${maxTime}.`,
  };
}

function ledgerBoundsCheck(
  inspection: TransactionXdrInspection,
  parameters: StellarNetworkParameters,
): TransactionPreconditionCheck | null {
  if (!inspection.ledgerBounds) return null;
  const candidateLedger = parameters.ledgerSequence + 1;
  const { minLedger, maxLedger } = inspection.ledgerBounds;
  if (candidateLedger < minLedger) {
    return {
      code: 'ledger_bounds',
      status: 'wait',
      detail: `Earliest next ledger ${candidateLedger} is below minLedger ${minLedger}.`,
    };
  }
  if (maxLedger !== 0 && candidateLedger >= maxLedger) {
    return {
      code: 'ledger_bounds',
      status: 'fail',
      failureKind: 'expired',
      detail: `Earliest next ledger ${candidateLedger} is at or beyond exclusive maxLedger ${maxLedger}.`,
    };
  }
  return {
    code: 'ledger_bounds',
    status: 'pass',
    detail: maxLedger === 0
      ? `Earliest next ledger ${candidateLedger} satisfies minLedger ${minLedger}; no maxLedger is set.`
      : `Earliest next ledger ${candidateLedger} is within [${minLedger}, ${maxLedger}).`,
  };
}

function minSequenceAgeCheck(
  inspection: TransactionXdrInspection,
  source: StellarAccountSnapshot,
  parameters: StellarNetworkParameters | null,
): TransactionPreconditionCheck | null {
  const rawAge = inspection.minAccountSequenceAge;
  if (rawAge === undefined || rawAge === '0') return null;

  let minimumAge: bigint;
  try {
    minimumAge = parseBigInt(rawAge, 'minimum sequence age');
  } catch (cause) {
    return {
      code: 'min_sequence_age',
      status: 'unknown',
      detail: cause instanceof Error ? cause.message : 'Unable to parse minimum sequence age.',
    };
  }

  if (source.sequenceTime === undefined) {
    return {
      code: 'min_sequence_age',
      status: 'unknown',
      detail: 'Horizon did not provide the source account sequence_time required to evaluate minSeqAge.',
    };
  }
  const ledgerTime = referenceTimeSeconds(parameters);
  if (ledgerTime === null) {
    return { code: 'min_sequence_age', status: 'unknown', detail: 'Latest ledger close time is unavailable.' };
  }

  let sequenceTime: bigint;
  try {
    sequenceTime = parseBigInt(source.sequenceTime, 'source sequence time');
  } catch (cause) {
    return {
      code: 'min_sequence_age',
      status: 'unknown',
      detail: cause instanceof Error ? cause.message : 'Unable to parse source sequence time.',
    };
  }

  const age = ledgerTime - sequenceTime;
  if (age < minimumAge) {
    return {
      code: 'min_sequence_age',
      status: 'wait',
      detail: `Source sequence age is ${age < 0n ? 0n : age}s; minSeqAge requires ${minimumAge}s.`,
    };
  }
  return {
    code: 'min_sequence_age',
    status: 'pass',
    detail: `Source sequence age ${age}s satisfies minSeqAge ${minimumAge}s.`,
  };
}

function minSequenceLedgerGapCheck(
  inspection: TransactionXdrInspection,
  source: StellarAccountSnapshot,
  parameters: StellarNetworkParameters,
): TransactionPreconditionCheck | null {
  const minimumGap = inspection.minAccountSequenceLedgerGap ?? 0;
  if (minimumGap === 0) return null;
  if (source.sequenceLedger === undefined) {
    return {
      code: 'min_sequence_ledger_gap',
      status: 'unknown',
      detail: 'Horizon did not provide the source account sequence_ledger required to evaluate minSeqLedgerGap.',
    };
  }

  const candidateLedger = parameters.ledgerSequence + 1;
  const gap = candidateLedger - source.sequenceLedger;
  if (gap < minimumGap) {
    return {
      code: 'min_sequence_ledger_gap',
      status: 'wait',
      detail: `Earliest next ledger is ${gap} ledger(s) after the source sequence; minSeqLedgerGap requires ${minimumGap}.`,
    };
  }
  return {
    code: 'min_sequence_ledger_gap',
    status: 'pass',
    detail: `Earliest next ledger is ${gap} ledger(s) after the source sequence, satisfying minSeqLedgerGap ${minimumGap}.`,
  };
}

export interface TransactionPreconditionContext {
  networkParameters?: StellarNetworkParameters | null;
  // Retained for callers compiled against the earlier evaluator contract.
  // Ledger-time checks intentionally never use wall clock time.
  now?: Date;
}

export function assessTransactionPreconditions(
  inspection: TransactionXdrInspection,
  source: StellarAccountSnapshot | null,
  context: TransactionPreconditionContext = {},
): TransactionPreconditionAssessment {
  const parameters = context.networkParameters ?? null;
  const checks: TransactionPreconditionCheck[] = [];
  if (!source) {
    checks.push({
      code: 'sequence',
      status: 'unknown',
      detail: 'The current transaction source account state is unavailable.',
    });
  } else {
    checks.push(sequenceCheck(inspection, source));
  }

  const time = timeBoundsCheck(inspection, parameters);
  if (time) checks.push(time);

  if (inspection.ledgerBounds) {
    if (parameters) checks.push(ledgerBoundsCheck(inspection, parameters)!);
    else checks.push({
      code: 'ledger_bounds',
      status: 'unknown',
      detail: 'Latest ledger sequence is unavailable, so ledger bounds cannot be evaluated.',
    });
  }

  if (source) {
    const age = minSequenceAgeCheck(inspection, source, parameters);
    if (age) checks.push(age);
    if ((inspection.minAccountSequenceLedgerGap ?? 0) > 0) {
      if (parameters) checks.push(minSequenceLedgerGapCheck(inspection, source, parameters)!);
      else checks.push({
        code: 'min_sequence_ledger_gap',
        status: 'unknown',
        detail: 'Latest ledger sequence is unavailable, so minSeqLedgerGap cannot be evaluated.',
      });
    }
  }

  const failures = checks.filter((check) => check.status === 'fail');
  const status: TransactionPreconditionOverallStatus = failures.some((check) => check.failureKind === 'stale')
    ? 'stale'
    : failures.some((check) => check.failureKind === 'expired')
      ? 'expired'
      : checks.some((check) => check.status === 'wait')
        ? 'not_yet_valid'
        : checks.some((check) => check.status === 'unknown')
          ? 'unknown'
          : 'ready';

  return {
    status,
    readyForSubmit: status === 'ready',
    checks,
  };
}
