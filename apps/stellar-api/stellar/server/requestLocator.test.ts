import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCapabilityToken,
  createSigningRequestId,
  encodeCapabilityToken,
  encodeSigningRequestId,
  isValidSigningRequestId,
} from './requestLocator.js';

test('encodes an 80-bit request id as 16 Crockford Base32 characters', () => {
  const id = encodeSigningRequestId(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.equal(id.length, 16);
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{16}$/);
  assert.equal(isValidSigningRequestId(id), true);
});

test('encodes a 128-bit capability as 26 human-friendly Crockford Base32 characters', () => {
  const capability = encodeCapabilityToken(Uint8Array.from([
    0, 1, 2, 3, 4, 5, 6, 7,
    8, 9, 10, 11, 12, 13, 14, 15,
  ]));
  assert.equal(capability.length, 26);
  assert.match(capability, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.doesNotMatch(capability, /[ILOU_-]/);
});

test('generates compact request ids and 128-bit bearer capabilities', () => {
  const id = createSigningRequestId();
  const capability = createCapabilityToken();
  assert.equal(id.length, 16);
  assert.equal(capability.length, 26);
  assert.match(capability, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(isValidSigningRequestId(id), true);
});

test('rejects non-current request id formats', () => {
  assert.equal(isValidSigningRequestId('FEyE-wkcmGxG-njFMZ0D_XVPd7upHEuA'), false);
  assert.equal(isValidSigningRequestId('not-a-request-id'), false);
});
