export const MAX_STELLAR_TEXT_MEMO_BYTES = 28;

export function stellarTextMemoByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function isValidStellarTextMemo(value: string): boolean {
  return stellarTextMemoByteLength(value) <= MAX_STELLAR_TEXT_MEMO_BYTES;
}
