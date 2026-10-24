import { isValidStellarAccountId } from './horizon.js';
import { paymentAssetChoices } from './paymentAsset.js';
import type { PaymentAssetChoice } from './paymentAsset.js';
import { stellarAmountToStroops, stroopsToStellarAmount } from './reserve.js';
import type { StellarAccountSnapshot } from './types.js';

export type StructuredTransferMode = 'batch' | 'multi_party';

export interface AddressAliasLike {
  address: string;
  label: string;
}

export interface StructuredTransferRow {
  line: number;
  source?: string;
  destination: string;
  amount: string;
  assetToken: string;
}

export interface ResolvedTransferRow {
  line: number;
  source: string;
  destination: string;
  amount: string;
  asset: PaymentAssetChoice;
}

export interface TransferIssue {
  line?: number;
  message: string;
}

export interface TransferWarning {
  line?: number;
  message: string;
}

export interface TransferParseResult {
  rows: StructuredTransferRow[];
  issues: TransferIssue[];
}

export interface TransferValidationResult {
  rows: ResolvedTransferRow[];
  issues: TransferIssue[];
  warnings: TransferWarning[];
}

export interface TransferTotal {
  assetKey: string;
  code: string;
  issuer?: string;
  amount: string;
}

const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;
const MAX_CLASSIC_OPERATIONS = 100;

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function splitColumns(line: string): string[] {
  if (line.includes(',')) return parseCsvLine(line);
  if (line.includes('\t')) return line.split('\t').map((value) => value.trim());
  return line.trim().split(/\s+/);
}

function normalizedHeader(values: string[]): string[] {
  return values.map((value) => value.trim().toLowerCase().replace(/[ _-]+/g, ''));
}

function isHeader(mode: StructuredTransferMode, values: string[]): boolean {
  const header = normalizedHeader(values);
  if (mode === 'batch') {
    return header.length >= 3
      && ['to', 'recipient', 'destination', 'address', 'name'].includes(header[0])
      && ['amount', 'value'].includes(header[1])
      && ['asset', 'currency', 'token'].includes(header[2]);
  }
  return header.length >= 4
    && ['from', 'source', 'payer'].includes(header[0])
    && ['to', 'recipient', 'destination'].includes(header[1])
    && ['amount', 'value'].includes(header[2])
    && ['asset', 'currency', 'token'].includes(header[3]);
}

function aliasMatches(token: string, aliases: readonly AddressAliasLike[]): string[] {
  const normalized = token.trim().toLocaleLowerCase();
  return [...new Set(
    aliases
      .filter((entry) => entry.label.trim().toLocaleLowerCase() === normalized)
      .map((entry) => entry.address.trim())
      .filter(isValidStellarAccountId),
  )];
}

export function resolveAddressToken(token: string, aliases: readonly AddressAliasLike[]): { address?: string; issue?: string } {
  const normalized = token.trim();
  if (isValidStellarAccountId(normalized)) return { address: normalized };
  const matches = aliasMatches(normalized, aliases);
  if (matches.length === 1) return { address: matches[0] };
  if (matches.length > 1) return { issue: `“${normalized}” matches more than one saved address. Use the full Stellar address.` };
  return { issue: `“${normalized}” is not a Stellar address or a unique saved name.` };
}

export function parseStructuredTransfers(
  mode: StructuredTransferMode,
  input: string,
  aliases: readonly AddressAliasLike[],
): TransferParseResult {
  const rows: StructuredTransferRow[] = [];
  const issues: TransferIssue[] = [];
  const rawLines = input.split(/\r?\n/);
  let firstDataLine = true;

  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index].trim();
    if (!raw || raw.startsWith('#')) continue;
    const lineNumber = index + 1;
    const values = splitColumns(raw);
    if (firstDataLine && isHeader(mode, values)) {
      firstDataLine = false;
      continue;
    }
    firstDataLine = false;

    const expected = mode === 'batch' ? 3 : 4;
    if (values.length !== expected) {
      issues.push({ line: lineNumber, message: mode === 'batch'
        ? 'Expected recipient, amount, asset.'
        : 'Expected source, destination, amount, asset.' });
      continue;
    }

    const sourceToken = mode === 'multi_party' ? values[0] : undefined;
    const destinationToken = mode === 'batch' ? values[0] : values[1];
    const amount = mode === 'batch' ? values[1] : values[2];
    const assetToken = mode === 'batch' ? values[2] : values[3];

    if (!AMOUNT_PATTERN.test(amount) || stellarAmountToStroops(amount) <= 0n) {
      issues.push({ line: lineNumber, message: 'Amount must be greater than 0 with at most 7 decimal places.' });
      continue;
    }
    if (!assetToken.trim()) {
      issues.push({ line: lineNumber, message: 'Asset is required.' });
      continue;
    }

    let source: string | undefined;
    if (sourceToken !== undefined) {
      const resolved = resolveAddressToken(sourceToken, aliases);
      if (!resolved.address) {
        issues.push({ line: lineNumber, message: `Source: ${resolved.issue}` });
        continue;
      }
      source = resolved.address;
    }

    const destinationResolved = resolveAddressToken(destinationToken, aliases);
    if (!destinationResolved.address) {
      issues.push({ line: lineNumber, message: `Recipient: ${destinationResolved.issue}` });
      continue;
    }

    rows.push({
      line: lineNumber,
      ...(source ? { source } : {}),
      destination: destinationResolved.address,
      amount,
      assetToken: assetToken.trim(),
    });
  }

  if (rows.length === 0 && issues.length === 0) {
    issues.push({ message: 'Enter at least one transfer.' });
  }
  if (rows.length > MAX_CLASSIC_OPERATIONS) {
    issues.push({ message: `A Stellar Classic transaction can contain at most ${MAX_CLASSIC_OPERATIONS} operations.` });
  }
  if (mode === 'multi_party') {
    const sources = new Set(rows.map((row) => row.source).filter(Boolean));
    if (rows.length > 0 && sources.size < 2) {
      issues.push({ message: 'A multi-party transaction must involve at least two independent source accounts.' });
    }
  }

  return { rows, issues };
}

export function resolveAssetToken(token: string, account: StellarAccountSnapshot): { asset?: PaymentAssetChoice; issue?: string } {
  const normalized = token.trim();
  const choices = paymentAssetChoices(account);
  if (/^(xlm|native)$/i.test(normalized)) {
    return { asset: choices.find((choice) => choice.key === 'native') };
  }

  const colon = normalized.indexOf(':');
  if (colon > 0) {
    const code = normalized.slice(0, colon).trim();
    const issuer = normalized.slice(colon + 1).trim();
    if (!isValidStellarAccountId(issuer)) return { issue: `Asset issuer in “${normalized}” is not a valid Stellar address.` };
    const match = choices.find((choice) => choice.issuer === issuer && choice.code.toLocaleLowerCase() === code.toLocaleLowerCase());
    return match
      ? { asset: match }
      : { issue: `${account.accountId} does not currently hold ${code} from that issuer.` };
  }

  const matches = choices.filter((choice) => choice.code.toLocaleLowerCase() === normalized.toLocaleLowerCase());
  if (matches.length === 1) return { asset: matches[0] };
  if (matches.length === 0) return { issue: `${account.accountId} does not currently hold ${normalized}.` };
  return { issue: `${normalized} exists from more than one issuer. Use CODE:ISSUER so the asset is unambiguous.` };
}

export function validateTransferRows(
  mode: StructuredTransferMode,
  rows: readonly StructuredTransferRow[],
  accounts: ReadonlyMap<string, StellarAccountSnapshot>,
  batchSource?: string,
): TransferValidationResult {
  const resolved: ResolvedTransferRow[] = [];
  const issues: TransferIssue[] = [];
  const warnings: TransferWarning[] = [];

  for (const row of rows) {
    const source = mode === 'batch' ? batchSource?.trim() : row.source;
    if (!source || !isValidStellarAccountId(source)) {
      issues.push({ line: row.line, message: 'Source account is missing or invalid.' });
      continue;
    }
    const account = accounts.get(source);
    if (!account) {
      issues.push({ line: row.line, message: `Source account ${source} could not be loaded.` });
      continue;
    }
    const assetResolved = resolveAssetToken(row.assetToken, account);
    if (!assetResolved.asset) {
      issues.push({ line: row.line, message: assetResolved.issue ?? 'Asset could not be resolved.' });
      continue;
    }
    resolved.push({
      line: row.line,
      source,
      destination: row.destination,
      amount: row.amount,
      asset: assetResolved.asset,
    });
  }

  const exactSeen = new Map<string, number>();
  const recipientSeen = new Map<string, number>();
  for (const row of resolved) {
    const exactKey = `${row.source}|${row.destination}|${row.asset.key}`;
    const earlier = exactSeen.get(exactKey);
    if (earlier !== undefined) {
      issues.push({ line: row.line, message: `This source → recipient → asset combination already appears on line ${earlier}. Combine the amounts or make the duplicate intentional outside the batch parser.` });
    } else {
      exactSeen.set(exactKey, row.line);
    }

    if (mode === 'batch') {
      const recipientEarlier = recipientSeen.get(row.destination);
      if (recipientEarlier !== undefined && earlier === undefined) {
        warnings.push({ line: row.line, message: `This recipient also appears on line ${recipientEarlier} with another asset. Verify that both transfers are intentional.` });
      } else if (recipientEarlier === undefined) {
        recipientSeen.set(row.destination, row.line);
      }
    }
  }

  return { rows: resolved, issues, warnings };
}

export function transferTotals(rows: readonly ResolvedTransferRow[]): TransferTotal[] {
  const totals = new Map<string, { asset: PaymentAssetChoice; stroops: bigint }>();
  for (const row of rows) {
    const current = totals.get(row.asset.key);
    const stroops = stellarAmountToStroops(row.amount);
    if (current) current.stroops += stroops;
    else totals.set(row.asset.key, { asset: row.asset, stroops });
  }
  return [...totals.entries()]
    .map(([assetKey, value]) => ({
      assetKey,
      code: value.asset.code,
      issuer: value.asset.issuer,
      amount: stroopsToStellarAmount(value.stroops),
    }))
    .sort((a, b) => a.code.localeCompare(b.code) || (a.issuer ?? '').localeCompare(b.issuer ?? ''));
}

export function transferTotalsBySourceAsset(rows: readonly ResolvedTransferRow[]): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const row of rows) {
    const key = `${row.source}|${row.asset.key}`;
    totals.set(key, (totals.get(key) ?? 0n) + stellarAmountToStroops(row.amount));
  }
  return totals;
}

export function assetForSourceKey(rows: readonly ResolvedTransferRow[], source: string, assetKey: string): PaymentAssetChoice | null {
  return rows.find((row) => row.source === source && row.asset.key === assetKey)?.asset ?? null;
}

export function amountFromStroops(value: bigint): string {
  return stroopsToStellarAmount(value);
}
