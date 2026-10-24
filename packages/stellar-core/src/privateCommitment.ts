import { hash } from '@stellar/stellar-sdk/base';

export const PRIVATE_COMMITMENT_VERSION = 1 as const;
export const PRIVATE_COMMITMENT_SALT_BYTES = 32;
export const MAX_PRIVATE_COMMITMENT_PAYLOAD_BYTES = 8 * 1024;
const DOMAIN = new TextEncoder().encode('multisig.tools/private-memo/v1\0');

export interface PrivateCommitmentRecord {
  version: 1;
  text: string;
  saltHex: string;
  hashHex: string;
  createdAt: string;
}

export interface PrivateCommitmentDraft {
  text: string;
  saltHex: string;
  hashHex: string;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(value: string): Uint8Array {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('Expected an even-length hexadecimal string.');
  }
  const result = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

export function normalizePrivateCommitmentText(value: string): string {
  const text = value.trim().normalize('NFC');
  if (!text) throw new Error('Private commitment text cannot be empty.');
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_PRIVATE_COMMITMENT_PAYLOAD_BYTES) {
    throw new Error('Private commitment text is too large.');
  }
  return text;
}

export function privateCommitmentPayloadByteLength(value: string): number {
  return new TextEncoder().encode(value.trim().normalize('NFC')).length;
}

export function computePrivateCommitment(value: string, salt: Uint8Array): PrivateCommitmentDraft {
  if (salt.length !== PRIVATE_COMMITMENT_SALT_BYTES) {
    throw new Error(`Private commitment salt must be exactly ${PRIVATE_COMMITMENT_SALT_BYTES} bytes.`);
  }
  const text = normalizePrivateCommitmentText(value);
  const payload = new TextEncoder().encode(text);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payload.length, false);
  const preimage = new Uint8Array(DOMAIN.length + salt.length + length.length + payload.length);
  let offset = 0;
  preimage.set(DOMAIN, offset); offset += DOMAIN.length;
  preimage.set(salt, offset); offset += salt.length;
  preimage.set(length, offset); offset += length.length;
  preimage.set(payload, offset);
  const digest = hash(preimage);
  return {
    text,
    saltHex: bytesToHex(salt),
    hashHex: bytesToHex(digest),
  };
}

export function computePrivateCommitmentFromHex(value: string, saltHex: string): PrivateCommitmentDraft {
  return computePrivateCommitment(value, hexToBytes(saltHex));
}

export function createPrivateCommitment(value: string): PrivateCommitmentDraft {
  const salt = new Uint8Array(PRIVATE_COMMITMENT_SALT_BYTES);
  globalThis.crypto.getRandomValues(salt);
  return computePrivateCommitment(value, salt);
}

export function privateCommitmentMatchesHash(record: Pick<PrivateCommitmentDraft, 'text' | 'saltHex'>, hashHex: string): boolean {
  try {
    return computePrivateCommitmentFromHex(record.text, record.saltHex).hashHex === hashHex.trim().toLowerCase();
  } catch {
    return false;
  }
}
