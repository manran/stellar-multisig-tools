import { randomBytes } from 'node:crypto';

const CROCKFORD_BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const REQUEST_ID_BYTES = 10;
const CAPABILITY_BYTES = 16;
const REQUEST_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;

function encodeCrockfordBase32(bytes: Uint8Array): string {
  let value = 0;
  let bits = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += CROCKFORD_BASE32_ALPHABET[(value >> bits) & 31];
      value &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  if (bits > 0) output += CROCKFORD_BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function isValidSigningRequestId(id: string): boolean {
  return REQUEST_ID_PATTERN.test(id);
}

export function encodeSigningRequestId(bytes: Uint8Array): string {
  if (bytes.length !== REQUEST_ID_BYTES) throw new Error('Signing request ids require exactly 10 random bytes.');
  return encodeCrockfordBase32(bytes);
}

export function encodeCapabilityToken(bytes: Uint8Array): string {
  if (bytes.length !== CAPABILITY_BYTES) throw new Error('Capability tokens require exactly 16 random bytes.');
  return encodeCrockfordBase32(bytes);
}

export function createSigningRequestId(): string {
  return encodeSigningRequestId(randomBytes(REQUEST_ID_BYTES));
}

export function createCapabilityToken(): string {
  return encodeCapabilityToken(randomBytes(CAPABILITY_BYTES));
}
