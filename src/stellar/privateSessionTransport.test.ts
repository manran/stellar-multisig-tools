import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRIVATE_SESSION_ADDRESS_HEADER,
  privateSessionAddressFromRequest,
  privateSessionAddressHeaders,
} from '../../packages/stellar-core/src/privateSessionTransport.js';

const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

test('builds the selected-wallet session header from explicit connected identity', () => {
  assert.deepEqual(privateSessionAddressHeaders(`  ${ADDRESS}  `), {
    [PRIVATE_SESSION_ADDRESS_HEADER]: ADDRESS,
  });
  assert.deepEqual(privateSessionAddressHeaders('   '), {});
});

test('reads the selected-wallet session header case-insensitively and trims it', () => {
  const request = new Request('https://stellar.multisig.tools/api/request', {
    headers: { 'X-MultiSig-Session-Address': ` ${ADDRESS} ` },
  });
  assert.equal(privateSessionAddressFromRequest(request), ADDRESS);
  assert.equal(privateSessionAddressFromRequest(new Request('https://stellar.multisig.tools/api/request')), '');
});
