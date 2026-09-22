import type {
  AccountAuthorizationAnalysis,
  SecurityFinding,
  StellarAccountSnapshot,
  StellarSigner,
  ThresholdAuthorizationSummary,
  ThresholdLevel,
} from './types.js';

const LEVELS: ThresholdLevel[] = ['low', 'medium', 'high'];

function activeGeneralSigners(signers: StellarSigner[]): StellarSigner[] {
  return signers.filter((signer) => signer.weight > 0 && signer.type !== 'preauth_tx');
}

function minimumSignerCount(signers: StellarSigner[], threshold: number): number | null {
  if (signers.length === 0) return null;
  if (threshold <= 0) return 1;
  const weights = signers.map((signer) => signer.weight).sort((a, b) => b - a);
  let total = 0;
  for (let index = 0; index < weights.length; index += 1) {
    total += weights[index];
    if (total >= threshold) return index + 1;
  }
  return null;
}

function exampleMinimumSets(signers: StellarSigner[], threshold: number, count: number | null, limit = 6): string[][] {
  if (count === null) return [];
  const results: string[][] = [];
  const selected: StellarSigner[] = [];
  const visit = (start: number, remaining: number, weight: number) => {
    if (results.length >= limit) return;
    if (remaining === 0) {
      if (threshold <= 0 || weight >= threshold) results.push(selected.map((signer) => signer.key));
      return;
    }
    for (let index = start; index <= signers.length - remaining; index += 1) {
      selected.push(signers[index]);
      visit(index + 1, remaining - 1, weight + signers[index].weight);
      selected.pop();
      if (results.length >= limit) return;
    }
  };
  visit(0, count, 0);
  return results;
}

function exactNOfMPolicy(signers: StellarSigner[], threshold: number): { required: number; total: number } | null {
  if (signers.length === 0) return null;
  if (threshold <= 0) return { required: 1, total: signers.length };
  const ascending = signers.map((signer) => signer.weight).sort((a, b) => a - b);
  const descending = [...ascending].reverse();
  for (let required = 1; required <= signers.length; required += 1) {
    const weakestRequired = ascending.slice(0, required).reduce((sum, weight) => sum + weight, 0);
    const strongestFewer = descending.slice(0, required - 1).reduce((sum, weight) => sum + weight, 0);
    if (weakestRequired >= threshold && strongestFewer < threshold) return { required, total: signers.length };
  }
  return null;
}

function guaranteedSignerFailuresTolerated(signers: StellarSigner[], threshold: number): number | null {
  if (signers.length === 0) return null;
  const weights = signers.map((signer) => signer.weight).sort((a, b) => b - a);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let lostWeight = 0;
  let tolerated = 0;
  for (let failures = 1; failures < signers.length; failures += 1) {
    lostWeight += weights[failures - 1];
    const remainingCount = signers.length - failures;
    const reachable = remainingCount > 0 && (threshold <= 0 || totalWeight - lostWeight >= threshold);
    if (!reachable) break;
    tolerated = failures;
  }
  return tolerated;
}

function summarizeThreshold(level: ThresholdLevel, threshold: number, signers: StellarSigner[]): ThresholdAuthorizationSummary {
  const active = activeGeneralSigners(signers);
  const totalActiveWeight = active.reduce((sum, signer) => sum + signer.weight, 0);
  const count = minimumSignerCount(active, threshold);
  const exactNOfM = exactNOfMPolicy(active, threshold);
  const reachable = active.length > 0 && (threshold <= 0 || threshold <= totalActiveWeight);
  return {
    level,
    threshold,
    reachable,
    totalActiveWeight,
    minimumSignerCount: count,
    singleSignerKeys: active.filter((signer) => threshold <= 0 || signer.weight >= threshold).map((signer) => signer.key),
    exampleMinimumSets: exampleMinimumSets(active, threshold, count),
    policyLabel: !reachable ? 'Unreachable' : exactNOfM ? `${exactNOfM.required}-of-${exactNOfM.total}` : `Weighted · min ${count ?? '?'} signer${count === 1 ? '' : 's'}`,
    exactNOfM,
    guaranteedSignerFailuresTolerated: reachable ? guaranteedSignerFailuresTolerated(active, threshold) : null,
  };
}

function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }

function buildFindings(account: StellarAccountSnapshot, summaries: Record<ThresholdLevel, ThresholdAuthorizationSummary>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const { low, medium, high } = account.thresholds;
  const masterKeyWeight = account.signers.find((signer) => signer.key === account.accountId)?.weight ?? 0;
  const generalSigners = activeGeneralSigners(account.signers);
  const preauthCount = account.signers.filter((signer) => signer.weight > 0 && signer.type === 'preauth_tx').length;
  const hashXCount = account.signers.filter((signer) => signer.weight > 0 && signer.type === 'sha256_hash').length;
  const signedPayloadCount = account.signers.filter((signer) => signer.weight > 0 && signer.type === 'ed25519_signed_payload').length;
  const singleControllerKey = generalSigners.length === 1
    && LEVELS.every((level) => summaries[level].singleSignerKeys.includes(generalSigners[0].key))
    ? generalSigners[0].key
    : null;
  if (generalSigners.length === 0) findings.push({ severity: 'critical', title: 'No reusable signer can authorize new transactions', detail: 'The account has no active general-purpose signer. Pre-authorized transaction signers, if present, only authorize their specific transaction.' });
  if (low > medium || medium > high) findings.push({ severity: 'warning', title: 'Unusual threshold ordering', detail: `This account uses low ${low}, medium ${medium}, high ${high}. Most Stellar multisig policies use low <= medium <= high.` });
  for (const level of LEVELS) {
    const summary = summaries[level];
    if (!summary.reachable) findings.push({ severity: 'critical', title: `${capitalize(level)} authorization cannot be reached`, detail: `The ${level} threshold is ${summary.threshold}, while reusable signer weight totals ${summary.totalActiveWeight}.` });
  }
  if (masterKeyWeight === 0) findings.push({ severity: 'info', title: 'Master key is disabled', detail: 'The account master key has weight 0. Access depends on the remaining configured signers.' });
  if (preauthCount > 0) findings.push({ severity: 'info', title: `${preauthCount} pre-authorized transaction signer${preauthCount === 1 ? '' : 's'} excluded from generic reachability`, detail: 'A preauth_tx signer authorizes only its matching transaction, so it is not treated as reusable control of the account.' });
  if (hashXCount > 0) findings.push({ severity: 'warning', title: `${hashXCount} active Hash(x) signer${hashXCount === 1 ? '' : 's'}`, detail: 'Hash(x) can authorize transactions while configured, but its secret preimage becomes public when used. Treat it differently from a reusable private key.' });
  if (signedPayloadCount > 0) findings.push({ severity: 'warning', title: `${signedPayloadCount} active signed-payload signer${signedPayloadCount === 1 ? '' : 's'}`, detail: 'A signed-payload signer verifies a fixed payload rather than the transaction hash. Once that signature is disclosed, it can be replayed for this signer while the signer remains configured.' });
  if (singleControllerKey) findings.push({ severity: 'info', title: 'Single-signature account', detail: `All account permissions are currently controlled by ${singleControllerKey}. Add independent signer keys to create a recovery path or require multiple approvals.` });
  if (!singleControllerKey && summaries.medium.singleSignerKeys.length > 0) findings.push({ severity: 'warning', title: 'A single signer can authorize medium-threshold operations', detail: `${summaries.medium.singleSignerKeys.length} signer(s) individually meet the medium requirement, which covers payments and most day-to-day operations.` });
  if (!singleControllerKey && summaries.high.singleSignerKeys.length > 0) findings.push({ severity: 'warning', title: 'A single signer can authorize high-threshold operations', detail: `${summaries.high.singleSignerKeys.length} signer(s) individually meet the high requirement used for signer/threshold changes and account merge.` });
  if (findings.length === 0) findings.push({ severity: 'info', title: 'No obvious threshold lockout detected', detail: 'All configured threshold levels are reachable with the currently reusable signer weights.' });
  return findings;
}

export function analyzeAccountAuthorization(account: StellarAccountSnapshot): AccountAuthorizationAnalysis {
  const active = activeGeneralSigners(account.signers);
  const totalActiveWeight = active.reduce((sum, signer) => sum + signer.weight, 0);
  const masterKeyWeight = account.signers.find((signer) => signer.key === account.accountId)?.weight ?? 0;
  const thresholds = {
    low: summarizeThreshold('low', account.thresholds.low, account.signers),
    medium: summarizeThreshold('medium', account.thresholds.medium, account.signers),
    high: summarizeThreshold('high', account.thresholds.high, account.signers),
  };
  return { totalActiveWeight, activeSignerCount: active.length, masterKeyWeight, thresholds, findings: buildFindings(account, thresholds) };
}
