import { isValidStellarAccountId } from '../../../../packages/stellar-core/src/horizon';

export interface SignerInputAnalysis {
  normalized: string[];
  signerKeys: string[];
  errors: string[];
}

export function analyzeSignerInputs(values: string[], masterAccountId: string): SignerInputAnalysis {
  const normalized = values.map((value) => value.trim());
  const signerKeys = normalized.filter(Boolean);
  const errors = normalized.map((value, index) => {
    if (!value) return '';
    if (!isValidStellarAccountId(value)) return 'Enter a valid Stellar G... address.';
    if (masterAccountId && value === masterAccountId) return 'The account key is already managed above.';
    if (normalized.findIndex((candidate) => candidate === value) !== index) return 'This signer is already listed.';
    return '';
  });
  return { normalized, signerKeys, errors };
}

function compactSignerRows(values: string[]): string[] {
  const next = values.length > 0 ? [...values] : [''];
  while (next.length > 1 && !next[next.length - 1].trim() && !next[next.length - 2].trim()) next.pop();
  return next;
}

export function updateSignerInputRows(values: string[], index: number, value: string): string[] {
  const next = [...values];
  next[index] = value;
  const normalized = value.trim();
  if (index === next.length - 1 && normalized && isValidStellarAccountId(normalized)) next.push('');
  return compactSignerRows(next);
}

export function removeSignerInputRow(values: string[], index: number): string[] {
  const next = values.filter((_, signerIndex) => signerIndex !== index);
  if (next.length === 0 || next[next.length - 1].trim()) next.push('');
  return compactSignerRows(next);
}

export function addSavedSignerRow(values: string[], address: string): string[] {
  const normalizedAddress = address.trim();
  if (!isValidStellarAccountId(normalizedAddress)) return values;
  if (values.some((value) => value.trim() === normalizedAddress)) return values;

  const next = [...values];
  const emptyIndex = next.findIndex((value) => !value.trim());
  if (emptyIndex >= 0) next[emptyIndex] = normalizedAddress;
  else next.push(normalizedAddress);
  if (next[next.length - 1].trim()) next.push('');
  return compactSignerRows(next);
}
